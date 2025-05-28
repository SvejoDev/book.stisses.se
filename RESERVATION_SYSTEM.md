# Real-time Booking Reservation System

This document describes the implementation of the real-time booking reservation system that prevents double bookings and allows multiple bookings by the same user.

## Overview

The system works by temporarily reserving availability when users select a start time, then converting those reservations to permanent bookings when payment is completed.

## Architecture

### Database Changes

Added two columns to `pending_bookings` table:

- `expires_at` (timestamp) - When the reservation expires (15 minutes from creation/update)
- `availability_reserved` (boolean) - Whether availability is currently reserved

### API Endpoints

1. **`/api/reserve-availability`** - Creates/extends temporary reservations
2. **`/api/cleanup-expired`** - Cleans up expired reservations
3. **`/api/check-availability`** - Modified to include reserved quantities
4. **`/api/webhook`** - Modified to mark reservations as permanent
5. **`/api/create-checkout-session`** - Modified to work with existing reservations

### Shared Utilities

- **`src/lib/utils/availability-helpers.ts`** - Shared functions for availability management

## Flow

### 1. User Selects Start Time

- `AvailableStartTimes.svelte` calls `/api/reserve-availability`
- Availability is immediately reserved in availability tables
- 15-minute timer starts
- User sees reservation confirmation

### 2. User Adds Multiple Bookings

- Each additional booking extends the 15-minute timer
- All reservations remain active under the same booking number

### 3. User Proceeds to Payment

- `ContactForm` uses existing booking number
- Stripe checkout session is created with reservation data

### 4. Payment Completes

- Webhook marks `availability_reserved = false`
- Availability remains blocked but is now permanent
- Confirmation emails are sent

### 5. Cleanup

- **Browser close**: `beforeunload` event triggers immediate cleanup
- **Periodic**: Cron job calls `/api/cleanup-expired` every 5 minutes
- **Expired reservations**: Automatically removed, availability restored

## Setup Instructions

### 1. Database Migration

The required columns should already be added to your `pending_bookings` table:

```sql
ALTER TABLE pending_bookings
ADD COLUMN expires_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN availability_reserved BOOLEAN DEFAULT FALSE;
```

### 2. Cron Job Setup

Set up a cron job to clean expired reservations every 5 minutes:

```bash
# Add to your crontab (crontab -e)
*/5 * * * * curl -X GET https://your-domain.com/api/cleanup-expired
```

Or if using Vercel, add to `vercel.json`:

```json
{
	"crons": [
		{
			"path": "/api/cleanup-expired",
			"schedule": "*/5 * * * *"
		}
	]
}
```

### 3. Environment Variables

No additional environment variables required - uses existing Supabase configuration.

## Key Features

### Real-time Availability

- Availability is updated immediately when users select times
- Other users see accurate availability in real-time
- Prevents double bookings completely

### Multiple Bookings

- Users can make multiple bookings with a single payment
- All bookings share the same 15-minute reservation window
- Availability is properly tracked across all bookings

### Graceful Cleanup

- Three-tier cleanup system ensures no orphaned reservations
- Browser close detection for immediate cleanup
- Periodic cleanup for failsafe
- Expired reservation detection in availability checks

### Error Handling

- Rollback mechanisms if reservation fails
- Graceful degradation if cleanup fails
- Detailed error logging for debugging

## Testing

### Test Scenarios

1. **Single Booking Flow**

   - Select time → Reserve → Pay → Confirm
   - Verify availability is blocked throughout

2. **Multiple Booking Flow**

   - Select time for booking 1 → Add booking 2 → Select time → Pay
   - Verify 15-minute timer extends with each booking

3. **Concurrent Users**

   - Two users try to book same time simultaneously
   - Verify only first user succeeds

4. **Abandonment**

   - Select time → Close browser
   - Verify availability is restored after cleanup

5. **Expiry**
   - Select time → Wait 15+ minutes
   - Verify availability is restored automatically

### Manual Testing Commands

```bash
# Test cleanup endpoint
curl -X GET https://your-domain.com/api/cleanup-expired

# Test specific booking cleanup
curl -X POST https://your-domain.com/api/cleanup-expired \
  -H "Content-Type: application/json" \
  -d '{"bookingNumber": "BK-1234567890-abc123"}'
```

## Monitoring

### Key Metrics to Monitor

1. **Reservation Success Rate**

   - Track successful vs failed reservations
   - Monitor for availability conflicts

2. **Cleanup Effectiveness**

   - Monitor expired reservations cleanup
   - Track orphaned reservations

3. **User Experience**
   - Monitor reservation-to-payment conversion
   - Track abandonment rates

### Logs to Watch

- `Error reserving availability` - Availability conflicts
- `Failed to rollback availability` - Cleanup issues
- `Error cleaning up booking` - Cleanup failures
- `Failed to send confirmation email` - Email delivery issues

## Troubleshooting

### Common Issues

1. **Availability Not Updating**

   - Check if cleanup cron job is running
   - Verify database connectivity
   - Check for expired reservations

2. **Double Bookings**

   - Verify availability tables are being updated
   - Check for race conditions in reservation logic
   - Monitor concurrent user scenarios

3. **Orphaned Reservations**
   - Run manual cleanup: `GET /api/cleanup-expired`
   - Check cron job configuration
   - Verify browser close detection

### Manual Cleanup

If needed, manually clean up orphaned reservations:

```sql
-- Find expired reservations
SELECT * FROM pending_bookings
WHERE availability_reserved = true
AND expires_at < NOW();

-- Clean up specific booking (replace with actual booking_number)
DELETE FROM pending_bookings
WHERE booking_number = 'BK-1234567890-abc123'
AND availability_reserved = true;
```

## Performance Considerations

- Availability checks now include reservation queries
- Cleanup runs every 5 minutes (adjust frequency as needed)
- Browser close detection uses `sendBeacon` for reliability
- Database indexes on `expires_at` and `availability_reserved` recommended

## Future Enhancements

1. **Dynamic Reservation Time**

   - Allow different reservation times per experience type
   - Extend time for complex bookings

2. **Reservation Analytics**

   - Track reservation patterns
   - Optimize reservation duration

3. **Advanced Cleanup**
   - Intelligent cleanup based on user behavior
   - Predictive availability management
