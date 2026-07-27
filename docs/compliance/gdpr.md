# GDPR Compliance

**Status: Draft — not certified**

## Article 15 — Right of Access (Data Export)

Users can request a copy of their personal data via the audit-export route. The export produces a JSON file containing all logged operations and stored field values associated with the requesting user.

## Article 17 — Right to Erasure (Right to be Forgotten)

Deletion of personal data is handled by the `retention` admin RPC, which purges records older than a configurable retention period and supports ad-hoc user deletion requests.

## Article 20 — Right to Portability

Personal data can be exported in CSV format via the existing audit-export route. The export includes all user-contributed field values and metadata in a machine-readable format.

## DPA Template

A Data Processing Agreement template is available upon request. Contact the engineering team to initiate the DPA process.

## Data Residency

Data is hosted on Supabase in the following region:

- **Primary region:** US East (us-east-1)

No cross-region replication is currently configured. Data remains within the selected Supabase region unless explicitly transferred.
