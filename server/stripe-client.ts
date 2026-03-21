import Stripe from 'stripe'

export async function getUncachableStripeClient() {
  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY environment variable is required')
  }
  return new Stripe(secretKey, {
    apiVersion: '2025-08-27.basil' as Stripe.LatestApiVersion,
  })
}

export async function getStripePublishableKey() {
  const key = process.env.STRIPE_PUBLISHABLE_KEY
  if (!key) {
    throw new Error('STRIPE_PUBLISHABLE_KEY environment variable is required')
  }
  return key
}
