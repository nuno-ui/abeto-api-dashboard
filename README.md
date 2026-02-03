# Abeto API Dashboard

Real-time status dashboard for monitoring Abeto API resources. See at a glance which resources are available, how many records exist, and whether the API is healthy.

## Features

- **API Health Monitoring**: Check if the API is responding
- **Resource Status**: View status of all 9 API resources
- **Record Counts**: See total records available in each resource
- **Last Record Info**: View the most recent record for each resource
- **Field Discovery**: See all available fields for each resource
- **Filter Options**: Know which filters are available for querying
- **Auto-refresh**: Data refreshes every 60 seconds

## Resources Monitored

| Resource | Description |
|----------|-------------|
| Deals | Sales deals in pipeline stages |
| Regions | Geographic regions by postal code |
| Installers | Solar panel installation companies |
| Opportunities | Qualified deals sent to installers |
| Calls | Phone calls for follow-up |
| Qualifications | Customer qualification records |
| Lost Reasons | Reasons for lost deals |
| Templates | WhatsApp message templates |
| Unmatched Calls | Calls pending resolution |

## Deploy to Vercel

### Option 1: One-Click Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR_USERNAME/abeto-api-dashboard&env=ABETO_API_URL,ABETO_API_KEY)

### Option 2: Manual Deploy

1. **Push to GitHub**

```bash
cd abeto-api-dashboard
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/abeto-api-dashboard.git
git push -u origin main
```

2. **Import to Vercel**

- Go to [vercel.com/new](https://vercel.com/new)
- Import your GitHub repository
- Add environment variables:
  - `ABETO_API_URL`: `https://abeto-backend.vercel.app/api`
  - `ABETO_API_KEY`: Your API key
- Click Deploy

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `ABETO_API_URL` | Base URL for the Abeto API | Yes |
| `ABETO_API_KEY` | Bearer token for authentication | Yes |

## Local Development

1. **Install dependencies**

```bash
npm install
```

2. **Create environment file**

```bash
cp .env.example .env.local
```

Edit `.env.local` with your API credentials.

3. **Run development server**

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Project Structure

```
abeto-api-dashboard/
├── src/
│   ├── app/
│   │   ├── globals.css    # Styles
│   │   ├── layout.tsx     # Root layout
│   │   └── page.tsx       # Dashboard page
│   └── lib/
│       └── api.ts         # API fetching logic
├── package.json
├── tsconfig.json
├── next.config.js
├── vercel.json            # Vercel configuration
└── README.md
```

## KPIs Displayed

For each resource:

- **Status**: Healthy, Degraded, or Error
- **Total Records**: Number of records available
- **Available Fields**: Count and list of queryable fields
- **Available Filters**: Query parameters supported
- **Pagination Support**: Whether resource supports pagination
- **Search Support**: Whether resource supports text search
- **Last Record**: Preview of most recent record with timestamps

## Customization

### Change Refresh Interval

Edit `src/app/page.tsx`:

```typescript
// Change from 60 to your preferred seconds
export const revalidate = 60;
```

### Add More Resources

Edit `src/lib/api.ts` and add a new fetch function following the existing pattern.

## Tech Stack

- **Next.js 14**: React framework with App Router
- **TypeScript**: Type safety
- **Vercel**: Deployment platform
- **CSS**: Custom styling (no framework dependencies)

## License

MIT
