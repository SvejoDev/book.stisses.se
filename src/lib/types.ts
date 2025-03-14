export interface AvailableTime {
    startTime: string;  // Format: "HH:mm"
    endTime: string;    // Format: "HH:mm"
}

export interface Product {
    id: number;
    name: string;
    description: string;
    total_quantity: number;
    imageUrl: string;
} 