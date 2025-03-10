-- Schema for Supabase Database

-- Users Table
CREATE TABLE users (
    id uuid PRIMARY KEY,
    user_type varchar,
    phone_number varchar,
    instance_id uuid,
    aud varchar,
    role varchar,
    email varchar,
    encrypted_password varchar,
    email_confirmed_at timestamptz,
    invited_at timestamptz,
    confirmation_token varchar,
    confirmation_sent_at timestamptz,
    recovery_token varchar,
    recovery_sent_at timestamptz,
    email_change_token_new varchar,
    email_change varchar,
    email_change_sent_at timestamptz,
    last_sign_in_at timestamptz,
    raw_app_meta_data jsonb,
    raw_user_meta_data jsonb,
    is_super_admin boolean,
    created_at timestamptz,
    updated_at timestamptz,
    phone text,
    phone_confirmed_at timestamptz,
    phone_change text,
    phone_change_token varchar,
    phone_change_sent_at timestamptz,
    confirmed_at timestamptz,
    email_change_token_current varchar,
    email_change_confirm_status smallint,
    banned_until timestamptz,
    reauthentication_token varchar,
    reauthentication_sent_at timestamptz,
    is_sso_user boolean,
    deleted_at timestamptz,
    is_anonymous boolean
);

-- Experiences Table
CREATE TABLE experiences (
    id integer PRIMARY KEY,
    name varchar,
    description text,
    type varchar,
    base_price_per_person numeric
);

-- Products Table
CREATE TABLE products (
    id integer PRIMARY KEY,
    name varchar,
    description text,
    total_quantity integer
);

-- Add-ons Table
CREATE TABLE add_ons (
    id integer PRIMARY KEY,
    name varchar,
    description text,
    price_per_person numeric
);

-- Durations Table
CREATE TABLE durations (
    id integer PRIMARY KEY,
    duration_type varchar,
    duration_value integer,
    extra_price numeric
);

-- Start Locations Table
CREATE TABLE start_locations (
    id integer PRIMARY KEY,
    experience_id integer REFERENCES experiences(id),
    name varchar,
    price_per_person numeric
);

-- Start Location Durations Table
CREATE TABLE start_location_durations (
    start_location_id integer REFERENCES start_locations(id),
    duration_id integer REFERENCES durations(id),
    PRIMARY KEY (start_location_id, duration_id)
);

-- Bookings Table
CREATE TABLE bookings (
    id integer PRIMARY KEY,
    experience_id integer REFERENCES experiences(id),
    start_location_id integer REFERENCES start_locations(id),
    start_location_duration_id integer,
    start_location_time_id integer,
    start_date date,
    number_of_people integer,
    total_price numeric,
    status varchar,
    payment_method varchar,
    invoice_details jsonb,
    customer_email varchar,
    customer_phone varchar,
    created_at timestamp without time zone,
    duration_id integer REFERENCES durations(id)
);

-- Booking Products Table
CREATE TABLE booking_products (
    booking_id integer REFERENCES bookings(id),
    product_id integer REFERENCES products(id),
    quantity integer,
    PRIMARY KEY (booking_id, product_id)
);

-- Booking Add-ons Table
CREATE TABLE booking_add_ons (
    booking_id integer REFERENCES bookings(id),
    add_on_id integer REFERENCES add_ons(id),
    PRIMARY KEY (booking_id, add_on_id)
);

-- Experience Open Dates Table
CREATE TABLE experience_open_dates (
    id integer PRIMARY KEY,
    experience_id integer REFERENCES experiences(id),
    type varchar NOT NULL CHECK (type IN ('interval', 'specific')),
    start_date date,
    end_date date,
    specific_date date,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_date_type CHECK (
        (type = 'interval' AND start_date IS NOT NULL AND end_date IS NOT NULL AND specific_date IS NULL) OR
        (type = 'specific' AND specific_date IS NOT NULL AND start_date IS NULL AND end_date IS NULL)
    )
);

-- Experience Blocked Dates Table
CREATE TABLE experience_blocked_dates (
    id integer PRIMARY KEY,
    experience_id integer REFERENCES experiences(id),
    start_date date NOT NULL,
    end_date date NOT NULL,
    reason text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_date_range CHECK (end_date >= start_date)
);

-- Create indexes for better query performance
CREATE INDEX idx_experience_open_dates_experience_id ON experience_open_dates(experience_id);
CREATE INDEX idx_experience_blocked_dates_experience_id ON experience_blocked_dates(experience_id);
CREATE INDEX idx_experience_open_dates_dates ON experience_open_dates(start_date, end_date, specific_date);
CREATE INDEX idx_experience_blocked_dates_dates ON experience_blocked_dates(start_date, end_date); 