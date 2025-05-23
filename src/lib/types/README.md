# Types Organization

This directory contains all TypeScript type definitions organized by domain for better maintainability and scalability.

## Structure

```
src/lib/types/
├── index.ts          # Main export file - import all types from here
├── api.ts            # API request/response types
├── availability.ts   # Availability and time-related types
├── booking.ts        # Booking-related types and re-exports
├── experience.ts     # Experience, location, and duration types
├── price.ts          # Price, VAT, and pricing-related types
├── product.ts        # Product-related types
├── addon.ts          # Addon-related types
└── README.md         # This file
```

## Usage

### Recommended Import Pattern

```typescript
// ✅ Import from the main index for most cases
import type { Product, Addon, BookingPayload, ExperienceType } from '$lib/types';

// ✅ Import from specific files when you need many types from one domain
import type {
	Product,
	ProductWithPrice,
	SelectedProduct,
	BookingProduct
} from '$lib/types/product';
```

### Legacy Compatibility

The old `src/lib/types.ts` file still works for backward compatibility:

```typescript
// ✅ Still works (backward compatibility)
import type { AvailableTime, Product } from '$lib/types';
```

## Domain Organization

### 🏢 **Experience** (`experience.ts`)

Core business entities:

- `Experience` - Main experience definition
- `StartLocation` - Available starting locations
- `Duration` - Time duration options
- `OpenDate` / `BlockedDate` - Availability calendar

### 💰 **Price** (`price.ts`)

Pricing and VAT handling:

- `ExperienceType` - Business customer types
- `PriceGroup` - Pricing tiers
- `PriceResult` - Price calculations
- `VAT_RATE` - Tax constant

### 📦 **Product** (`product.ts`)

Physical products:

- `Product` - Base product definition
- `SelectedProduct` - User selections
- `BookingProduct` - Booked product data

### 🔧 **Addon** (`addon.ts`)

Additional services:

- `Addon` - Base addon definition
- `SelectedAddon` - User selections
- `BookingAddon` - Booked addon data

### 📅 **Availability** (`availability.ts`)

Time and availability:

- `AvailableTime` - Time slots
- `AvailabilityRequest` - API requests
- `AvailabilityCache` - Internal caching

### 📋 **Booking** (`booking.ts`)

Booking management:

- `Booking` - Complete booking record
- `BookingHistory` - Change tracking
- Re-exports commonly used types

### 🌐 **API** (`api.ts`)

Request/response contracts:

- `BookingPayload` - Booking creation
- `RescheduleRequest` - Booking changes
- `ApiResponse<T>` - Generic API responses

## Migration Guide

### From Inline Types in API Files

**Before:**

```typescript
// In +server.ts files
interface Product {
	id: number;
	name: string;
	// ...
}
```

**After:**

```typescript
// In +server.ts files
import type { Product } from '$lib/types/product';
```

### From Old Types Structure

**Before:**

```typescript
import type { ExperienceType } from '$lib/types/price.types';
import type { Product } from '$lib/types';
```

**After:**

```typescript
import type { ExperienceType, Product } from '$lib/types';
```

## Best Practices

### 1. **Use Specific Imports**

```typescript
// ✅ Good - clear what you're using
import type { Product, Addon } from '$lib/types';

// ❌ Avoid - unclear dependencies
import type * as Types from '$lib/types';
```

### 2. **Extend Types When Needed**

```typescript
// ✅ Good - extend base types for specific use cases
interface ProductWithCustomData extends Product {
	customField: string;
}
```

### 3. **Use Type Unions for Variants**

```typescript
// ✅ Good - clear type variants
type ProductResponse = Product | ProductWithPrice;
```

### 4. **Document Complex Types**

```typescript
/**
 * Represents a booking with all related data
 * Used for displaying booking details and history
 */
export interface BookingWithDetails extends Booking {
	// ...
}
```

## Adding New Types

1. **Determine the domain** - Which file should contain your type?
2. **Add to the appropriate file** - Keep related types together
3. **Export from index.ts** - Make it available from the main export
4. **Update this README** - Document significant additions

## Type Naming Conventions

- **Interfaces**: PascalCase (`Product`, `BookingPayload`)
- **Types**: PascalCase (`ExperienceType`)
- **Constants**: UPPER_SNAKE_CASE (`VAT_RATE`)
- **Generic suffixes**:
  - `Request` for API requests
  - `Response` for API responses
  - `Payload` for data transfer objects
  - `WithX` for extended versions
