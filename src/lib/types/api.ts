// API request/response types
import type { SelectedProduct } from './product';
import type { SelectedAddon } from './addon';
import type { ExperienceType } from './price';

export interface BookingPayload {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    comment?: string;
    experienceId: number;
    experienceType: ExperienceType;
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

export interface RescheduleRequest {
    bookingId: string;
    newDate: string;
    newStartTime: string;
    newEndTime: string;
    reason?: string;
}

export interface RescheduleResponse {
    success: boolean;
    error?: string;
}

export interface ApiError {
    error: string;
    details?: any;
}

export interface ApiResponse<T = any> {
    data?: T;
    error?: string;
    success?: boolean;
} 