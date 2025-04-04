<script lang="ts">
    import type { PageData } from './$types';
    
    let { data } = $props<{ data: PageData }>();
</script>

<div class="container mx-auto max-w-3xl px-4 py-8">
    <div class="space-y-8">
        <header class="text-center">
            <h1 class="text-4xl font-bold">Booking Confirmed!</h1>
            <p class="text-xl text-muted-foreground">Booking number: {data.booking.booking_number}</p>
        </header>

        <div class="space-y-6">
            <!-- Display booking details -->
            <div class="rounded-lg border p-6">
                <h2 class="text-2xl font-semibold">Booking Details</h2>
                <!-- Add booking details here -->
            </div>

            <!-- Display receipt -->
            <div class="rounded-lg border p-6">
                <h2 class="text-2xl font-semibold">Receipt</h2>
                <!-- Add receipt details here -->
            </div>
        </div>
    </div>
</div>