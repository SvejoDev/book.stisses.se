// Booking-related shared types
export interface Experience {
  id: string;
  type: 'company' | 'private' | 'school';
  name: string;
  booking_foresight_hours: number;
}

export interface StartLocation {
  id: number;
  experience_id: number;
  name: string;
  imageUrl?: string | null;
  price_per_person?: number;
}

export interface Duration {
  id: number;
  start_location_id: number;
  duration_type: string;
  duration_value: number;
  extra_price: number;
}

export interface OpenDate {
  id: number;
  experience_id?: number | null;
  type: 'interval' | 'specific';
  start_date?: string | null;
  end_date?: string | null;
  specific_date?: string | null;
  created_at?: string | null;
  open_time: string;
  close_time: string;
}

export interface BlockedDate {
  id: number;
  experience_id?: number | null;
  start_date: string;
  end_date: string;
  reason?: string | null;
  created_at?: string | null;
}

export interface PriceGroup {
  id: number;
  experience_id?: number | null;
  start_location_id?: number | null;
  internal_name: string;
  display_name: string;
  price: number;
  is_payable: boolean;
}

export interface SelectedProduct {
  productId: number;
  quantity: number;
  price: number;
}

export interface SelectedAddon {
  addonId: number;
  quantity: number;
  price: number;
}

export interface SelectedStartTime {
  startTime: string;
  endTime: string;
}

export interface Product {
  id: number;
  name: string;
  description?: string | null;
  total_quantity: number;
  imageUrl?: string | null;
  price?: number | null;
}

export interface Addon {
  id: number;
  name: string;
  description?: string | null;
  total_quantity?: number | null;
  imageUrl?: string | null;
  created_at: string;
  track_availability?: boolean | null;
  pricing_type?: string | null;
  price?: number | null;
}

// Used for POST /api/create-checkout-session and webhook
export interface BookingPayload {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  comment?: string;
  experienceId: number;
  experienceType: 'private' | 'company' | 'school';
  startLocationId: number;
  durationId: number;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  hasBookingGuarantee?: boolean;
  totalPrice: number;
  priceGroups: Array<{ id: number; quantity: number }> | Record<string, number>;
  products: SelectedProduct[];
  addons: SelectedAddon[];
}

export interface BookingRequest {
  bookings: BookingPayload[];
} 