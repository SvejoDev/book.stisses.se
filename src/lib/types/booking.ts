// Booking-specific types only
export interface Booking {
    id: string;
    experience_id: number;
    experience_type: 'private' | 'company' | 'school';
    start_location_id: number;
    duration_id: number;
    start_date: string;
    start_time: string;
    end_date: string;
    end_time: string;
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    comment?: string;
    total_price: number;
    has_booking_guarantee: boolean;
    created_at: string;
    updated_at: string;
}

export interface BookingHistory {
    id: number;
    booking_id: string;
    action_type: 'reschedule' | 'cancel' | 'modify';
    old_data: Record<string, any>;
    new_data: Record<string, any>;
    reason?: string;
    created_at: string;
} 