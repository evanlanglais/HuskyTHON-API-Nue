# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HuskyTHON API Nue is the backend API for the HuskyTHON (University of Washington Husky Dance Marathon) mobile application. It serves as an intermediary between the mobile app and two primary external services:

1. **Google Calendar API** - retrieves event information
2. **DonorDrive API** - manages fundraising participants, teams, and donation data

The API is deployed to Azure App Services and uses Redis for caching to improve performance and reduce external API calls.

## Technology Stack

- **Runtime**: Node.js (22.x)
- **Framework**: Express.js
- **Caching**: Redis with express-redis-cache
- **Date/Time**: Luxon
- **External APIs**: Google Calendar API, DonorDrive API
- **HTTP Client**: Axios
- **Deployment**: Azure App Services
- **Package Manager**: npm

## Development Commands

```bash
# Start the development server (runs on port 3000 by default)
npm start

# Note: This project currently has no build, lint, or test scripts configured.
# Modify package.json to add these as needed.
```

**Port Configuration**: The server listens on `process.env.PORT` or defaults to port 3000. The `/health` endpoint provides a basic health check.

## Environment Variables

The application requires the following environment variables (typically in `.env`):

- `PORT` - Server port (default: 3000)
- `GOOGLE_API_KEY` - API key for Google Calendar API
- `MAIN_EVENT_DATE` - ISO date string for the main event
- `DONOR_DRIVE_URL` - Base URL for DonorDrive API
- `HUSKYTHON_EVENT_ID` - HuskyTHON event ID in DonorDrive
- `CACHE_HOSTNAME` - Redis host (e.g., Azure Cache for Redis)
- `CACHE_KEY` - Redis authentication key

## Architecture & Key Patterns

### Request/Response Flow

1. **Express Middleware Stack** (app.js):
   - Morgan logging (`morgan('dev')`)
   - CORS enabled
   - JSON body parsing
   - Cookie parsing
   - All routes scoped under `/api` except index and health endpoints

2. **Redis Caching Strategy**:
   - All external API calls are cached via `express-redis-cache`
   - Default cache expiry: 60 seconds
   - Custom cache key generation for search endpoints (MD5 hash of query)
   - Pattern: Middleware injects `res.express_redis_cache_name` → cache middleware checks/stores → handler executes

### Route Structure

```
routes/
  ├── index.js          # PDF serving (/fundraisinginitiatives)
  ├── events.js         # Google Calendar integration (/api/events, /api/main-event)
  ├── donorDrive.js     # DonorDrive API proxy (/api/participants/*, /api/teams/*)
  └── users.js          # Placeholder (unused)
```

### DonorDrive Integration Details

The DonorDrive router (`routes/donorDrive.js`) proxies requests to the external DonorDrive API. **Important security note**: The `/search` and `/leaderboard` endpoints require session cookies for authorization. The implementation:
1. Makes an initial request to `donordrive.participantList` to extract cookies from response headers
2. Reuses those cookies in the actual API query
3. This pattern is required because DonorDrive restricts search/leaderboard access behind authentication

Endpoints handle both **participants** and **teams** with search, leaderboard, and detail queries.

### Events Integration

The events router (`routes/events.js`) fetches events from Google Calendar:
- Filters events to show only those within the last 6 months (historical events are excluded)
- Handles both all-day events and timed events
- Sorts by start time
- Uses Luxon for robust date/timezone handling
- The `/main-event` endpoint returns a static date from `process.env.MAIN_EVENT_DATE`

### Redis Client Setup

`scripts/redisClient.js` creates a Redis connection with TLS (for Azure compatibility):
```javascript
redis.createClient(6380, process.env.CACHE_HOSTNAME, {
  auth_pass: process.env.CACHE_KEY,
  tls: {servername: process.env.CACHE_HOSTNAME}
})
```

### API Response Schema

`scripts/api.js` defines the `HuskythonEvent` object schema:
```javascript
{
  id, summary, start, end, allDay, timezone, location, link
}
```

## Deployment

The project uses GitHub Actions (`.github/workflows/`) to automatically build and deploy to Azure App Services on pushes to the `master` branch.

**Deployment Target**: Azure Web App named `huskython-api` with `preprod` slot

The workflow:
1. Checks out code on Node 22.x
2. Runs `npm install`
3. Uploads artifact and deploys to Azure using managed identity authentication

## Git Workflow

- **Primary branch**: `master`
- **Pull request convention**: Contributors open PRs against `master`
- **Branch naming**: Feature branches follow patterns like `event-fix`, `readme`
- Recent commits follow conventional commit format (feat:, fix:, chore:)

## Common Issues & Patterns to Watch

1. **DonorDrive Cookie Handling**: The search/leaderboard endpoints require fetching cookies first. If DonorDrive changes their authentication, these endpoints will fail.

2. **Cache Key Collisions**: Custom cache names are set for search endpoints using MD5 hashes to avoid collisions with query parameters.

3. **Event Filtering**: The 6-month historical cutoff in `getEventsList()` is applied server-side using Luxon timezone-aware comparisons.

4. **Error Handling**: All route handlers catch errors and return 500 status without detailed error info to the client. Errors are logged to console.

## File Organization

```
/
├── app.js              # Express app initialization and server setup
├── package.json        # Dependencies and scripts
├── README.md           # Project overview
├── routes/             # Route handlers (endpoints)
├── scripts/            # Utility modules (Redis, API schemas)
├── public/             # Static files (PDFs, HTML)
└── .github/workflows/  # CI/CD pipeline
```

