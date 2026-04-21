# Launch Checklist

## Local Pilot

- Confirm Node is installed: `node --version`
- Start the app: `npm start`
- Open [http://localhost:3000](http://localhost:3000)
- Sign in and confirm the correct role is being used
- Replace starter passwords or create real users in **Users**
- Create or update the client in **Clients**
- Add authorization number, effective dates, approved hours, approved units, and assessment metadata
- Build the client treatment plan in **Treatment plan**
- Run one test 97153 session and confirm graphs update
- Generate and review one 97153 note
- Run one test 97155 note if BCBA supervision is part of the workflow
- Run one parent training session if 97156 is part of the workflow
- Generate a mock funder report
- Run **Data Health** and review high-priority items
- Review the **Audit Log** as admin or BCBA
- Download a practice backup from **Clients**
- Back up the database: `npm run backup`

## Daily Closeout

- Finalize completed notes
- Review graphs for obvious data-entry errors
- Review audit entries for unexpected edits, deletes, or exports
- Back up the database: `npm run backup`
- Keep backup files somewhere safe, such as an encrypted external drive or approved secure storage

## Before Cloud / Team Use

- Replace starter local passwords before real-world use
- Review audit retention, export, and incident-response policies
- Move from `data/db.json` to a real database
- Add encrypted file storage for assessments, authorizations, and report attachments
- Add automated backups
- Add export/PDF workflow for notes and reports
- Use HIPAA-appropriate hosting and execute a BAA with required vendors
