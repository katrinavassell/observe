#!/usr/bin/env python3
"""
HISTORIC DATA BACKFILL: Import 12+ months of customer data
Status: Production-ready for dev testing
"""

import os
import sys
import json
import logging
from datetime import datetime, timedelta
import stripe
from typing import List, Dict, Tuple
import psycopg2
from dotenv import load_dotenv

load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class HistoricDataBackfill:
    def __init__(self):
        self.stripe_key = os.getenv('STRIPE_API_KEY')
        self.db_host = os.getenv('DB_HOST', 'localhost')
        self.db_port = os.getenv('DB_PORT', '5432')
        self.db_name = os.getenv('DB_NAME', 'observe')
        self.db_user = os.getenv('DB_USER', 'postgres')
        self.db_password = os.getenv('DB_PASSWORD')
        
        stripe.api_key = self.stripe_key
        
        self.conn = None
        self.quality_metrics = {
            'total_records': 0,
            'valid_records': 0,
            'skipped_records': 0,
            'quality_score': 0.0
        }

    def connect_db(self):
        """Connect to PostgreSQL database"""
        try:
            self.conn = psycopg2.connect(
                host=self.db_host,
                port=self.db_port,
                database=self.db_name,
                user=self.db_user,
                password=self.db_password
            )
            logger.info("Connected to database")
        except psycopg2.Error as e:
            logger.error(f"Database connection failed: {e}")
            raise

    def fetch_stripe_history(self, customer_id: str, months_back: int = 12) -> List[Dict]:
        """
        Fetch historical Stripe data for a customer
        Returns list of daily usage records
        """
        try:
            # Get customer from Stripe
            stripe_customer = stripe.Customer.retrieve(customer_id)
            
            # Get invoices (billing records)
            invoices = stripe.Invoice.list(
                customer=customer_id,
                limit=100,
                created={
                    'gte': int((datetime.now() - timedelta(days=months_back*30)).timestamp())
                }
            )
            
            # Get events (API usage)
            events = stripe.Event.list(
                type='invoice.created',
                limit=100
            )
            
            # Parse into daily records
            daily_records = []
            base_date = datetime.now() - timedelta(days=months_back*30)
            
            for i in range(months_back * 30):
                current_date = base_date + timedelta(days=i)
                
                # Sum usage for this day
                day_usage = 0
                for invoice in invoices.data:
                    invoice_date = datetime.fromtimestamp(invoice.created).date()
                    if invoice_date == current_date.date():
                        # Extract usage from line items
                        for line_item in invoice.lines.data:
                            if 'usage' in line_item:
                                day_usage += line_item.usage
                
                daily_records.append({
                    'date': current_date.date().isoformat(),
                    'customer_id': customer_id,
                    'api_calls': day_usage,
                    'plan': stripe_customer.metadata.get('plan', 'starter'),
                    'plan_limit': self._get_plan_limit(stripe_customer.metadata.get('plan', 'starter'))
                })
            
            logger.info(f"Fetched {len(daily_records)} days of Stripe history for {customer_id}")
            return daily_records
            
        except stripe.error.StripeError as e:
            logger.error(f"Stripe API error: {e}")
            return []

    def validate_record(self, record: Dict) -> Tuple[bool, str]:
        """
        Validate a data record
        Returns (is_valid, reason)
        """
        # Check required fields
        required_fields = ['date', 'customer_id', 'api_calls', 'plan', 'plan_limit']
        for field in required_fields:
            if field not in record:
                return False, f"Missing field: {field}"
        
        # Check data types
        try:
            datetime.fromisoformat(record['date'])
        except (ValueError, TypeError):
            return False, f"Invalid date format: {record['date']}"
        
        if not isinstance(record['api_calls'], (int, float)) or record['api_calls'] < 0:
            return False, f"Invalid api_calls: {record['api_calls']}"
        
        if record['api_calls'] > 10_000_000:  # Sanity check: 10M calls/day is suspicious
            return False, f"Unreasonable api_calls: {record['api_calls']}"
        
        if record['plan'] not in ['starter', 'pro', 'enterprise']:
            return False, f"Invalid plan: {record['plan']}"
        
        # Check consistency
        if record['api_calls'] > record['plan_limit']:
            return False, f"API calls exceed plan limit"
        
        return True, "valid"

    def insert_records(self, records: List[Dict]) -> int:
        """Insert records into database"""
        if not self.conn:
            logger.error("No database connection")
            return 0
        
        cursor = self.conn.cursor()
        inserted = 0
        
        try:
            for record in records:
                is_valid, reason = self.validate_record(record)
                
                self.quality_metrics['total_records'] += 1
                
                if not is_valid:
                    logger.warning(f"Skipping invalid record: {reason}")
                    self.quality_metrics['skipped_records'] += 1
                    continue
                
                try:
                    cursor.execute("""
                        INSERT INTO customer_usage (date, customer_id, api_calls, plan, plan_limit)
                        VALUES (%s, %s, %s, %s, %s)
                        ON CONFLICT (date, customer_id) DO UPDATE
                        SET api_calls = EXCLUDED.api_calls
                    """, (
                        record['date'],
                        record['customer_id'],
                        record['api_calls'],
                        record['plan'],
                        record['plan_limit']
                    ))
                    
                    self.quality_metrics['valid_records'] += 1
                    inserted += 1
                    
                except psycopg2.Error as e:
                    logger.error(f"Insert error for record {record}: {e}")
            
            self.conn.commit()
            logger.info(f"Inserted {inserted} records")
            
        except psycopg2.Error as e:
            logger.error(f"Database error: {e}")
            self.conn.rollback()
        finally:
            cursor.close()
        
        return inserted

    def calculate_quality_score(self) -> float:
        """Calculate data quality score (0-100)"""
        if self.quality_metrics['total_records'] == 0:
            return 0.0
        
        valid_percent = (self.quality_metrics['valid_records'] / self.quality_metrics['total_records']) * 100
        return valid_percent

    def backfill_customer(self, customer_id: str) -> Dict:
        """Backfill data for a single customer"""
        logger.info(f"Starting backfill for customer {customer_id}")
        
        start_time = datetime.now()
        
        # Fetch historical data
        records = self.fetch_stripe_history(customer_id, months_back=12)
        
        # Insert into database
        inserted = self.insert_records(records)
        
        # Calculate quality score
        quality_score = self.calculate_quality_score()
        self.quality_metrics['quality_score'] = quality_score
        
        end_time = datetime.now()
        duration = (end_time - start_time).total_seconds()
        
        result = {
            'customer_id': customer_id,
            'status': 'success',
            'records_imported': inserted,
            'quality_score': quality_score,
            'duration_seconds': duration,
            'metrics': self.quality_metrics.copy()
        }
        
        logger.info(f"Backfill complete for {customer_id}: {json.dumps(result)}")
        return result

    def backfill_all_customers(self, customer_ids: List[str]) -> List[Dict]:
        """Backfill data for multiple customers"""
        results = []
        
        for customer_id in customer_ids:
            try:
                result = self.backfill_customer(customer_id)
                results.append(result)
            except Exception as e:
                logger.error(f"Backfill failed for {customer_id}: {e}")
                results.append({
                    'customer_id': customer_id,
                    'status': 'error',
                    'error': str(e)
                })
        
        return results

    def _get_plan_limit(self, plan: str) -> int:
        """Get API call limit for plan"""
        limits = {
            'starter': 100_000,
            'pro': 1_000_000,
            'enterprise': 10_000_000
        }
        return limits.get(plan, 100_000)

    def close(self):
        """Close database connection"""
        if self.conn:
            self.conn.close()
            logger.info("Database connection closed")


def main():
    if len(sys.argv) < 2:
        print("Usage: python historic-data-backfill.py <customer_id> [<customer_id2> ...]")
        sys.exit(1)
    
    customer_ids = sys.argv[1:]
    
    backfill = HistoricDataBackfill()
    
    try:
        backfill.connect_db()
        results = backfill.backfill_all_customers(customer_ids)
        
        # Print results
        print(json.dumps(results, indent=2, default=str))
        
        # Exit with error if any failed
        failed = [r for r in results if r.get('status') == 'error']
        sys.exit(1 if failed else 0)
        
    finally:
        backfill.close()


if __name__ == '__main__':
    main()
