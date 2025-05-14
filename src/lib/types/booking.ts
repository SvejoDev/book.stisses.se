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
  imageUrl: string;
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
  experience_id: number;
  type: 'interval' | 'specific';
  start_date: string | null;
  end_date: string | null;
  specific_date: string | null;
  created_at: string;
  open_time: string;
  close_time: string;
}

export interface BlockedDate {
  id: number;
  experience_id: number;
  start_date: string;
  end_date: string;
  reason?: string | null;
  created_at: string;
}

export interface PriceGroup {
  id: number;
  experience_id: number;
  start_location_id: number | null;
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