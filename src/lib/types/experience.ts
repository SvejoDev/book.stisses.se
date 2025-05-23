// Experience-related types
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

export interface DurationResponse {
    duration_id: number;
    durations: Duration;
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