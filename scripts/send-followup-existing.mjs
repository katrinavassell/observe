import Pg from "pg";

const pool = new Pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

const RESEND_API_KEY = process.env.RESEND_API_KEY;
if (!RESEND_API_KEY) {
  console.error("RESEND_API_KEY not set");
  process.exit(1);
}

const DRY_RUN = process.argv.includes("--dry-run");

const users = await pool.query(
  `SELECT u.email, u.name
   FROM users u
   JOIN user_accounts ua ON ua.user_id = u.id AND ua.role = 'owner' AND ua.status = 'active'
   WHERE u.email IS NOT NULL
     AND u.password_hash = 'clerk-managed'
     AND u.email NOT LIKE '%@tansohq.com'
     AND u.email NOT LIKE '%@observe.test'`
);

console.log(`Found ${users.rows.length} existing users`);

let sent = 0;
for (const user of users.rows) {
  if (DRY_RUN) {
    console.log(`[DRY RUN] Would send follow-up to: ${user.email}`);
    continue;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: "Kat from Observe <kat@tansohq.com>",
      to: user.email,
      subject: "How's setup going?",
      html: `<p>Hey${user.name ? ` ${user.name}` : ""}!</p>
<p>Just checking in — have you had a chance to get your SDK key set up? If you're running into anything or have questions about connecting your data, I'm happy to help.</p>
<p>Here's a quick link to the setup guide: <a href="https://observe.tansohq.com/data-sources">observe.tansohq.com/data-sources</a></p>
<p>Or grab time with me directly: <a href="https://cal.com/katrina-laszlo/meeting">cal.com/katrina-laszlo/meeting</a></p>
<p>Kat<br/>Co-founder, Tanso</p>`,
    }),
  });

  if (res.ok) {
    sent++;
    console.log(`Sent follow-up to: ${user.email}`);
  } else {
    console.error(`Failed for ${user.email}: ${res.status} ${await res.text()}`);
  }
}

console.log(`Done. Sent ${sent}/${users.rows.length} follow-up emails.`);
await pool.end();
