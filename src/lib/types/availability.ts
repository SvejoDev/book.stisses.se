// Availability-related types
export interface AvailableTime {
    startTime: string;  // Format: "HH:mm"
    endTime: string;    // Format: "HH:mm"
}

export interface SelectedStartTime {
    startTime: string;
    endTime: string;
}

export interface AvailabilityRequest {
    date: string;
    durationType: 'hours' | 'overnights';
    durationValue: number;
    products: Array<{
        productId: number;
        quantity: number;
    }>;
    addons?: Array<{
        addonId: number;
        quantity: number;
    }>;
    experienceId: number;
}

export interface AvailabilityCache {
    [id: number]: {
        maxQuantity: number;
        availability: {
            [date: string]: {
                [minute: string]: number | null;
            };
        };
        type: 'product' | 'addon';
        trackAvailability: boolean;
    };
}

export interface AvailabilityResult {
    minute: number;
    isAvailable: boolean;
}

export interface AvailabilityUpdate {
    tableName: string;
    date: string;
    startMinutes: number;
    endMinutes: number;
    quantity: number;
    maxQuantity: number;
} 