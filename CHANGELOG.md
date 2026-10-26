# Changelog

## v0.2.0 - 2026-10-26

### Added

- Capture sale number, outturn number and mark on auction lots and make lots unique per sale and lot number

### Fixed

- Remove UUIDs from direct delivery list and not-found error messages shown to users
- Include supplier, grade, warehouse, contract and shipment names in lot traceability response




## v0.1.2 - 2026-09-13

### Fixed

- Enable gzip/brotli response compression on API to reduce payload size in production




## v0.1.1 - 2026-09-11

### Added

- Add changelog update step to release script

### Fixed

- Consolidate duplicate health check endpoints into single /v1/health route
