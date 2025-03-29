-- Create addons table
CREATE TABLE addons (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    total_quantity INTEGER NOT NULL DEFAULT 0,
    image_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create function to generate addon availability tables
CREATE OR REPLACE FUNCTION create_addon_availability_table()
RETURNS TRIGGER AS $$
BEGIN
    -- Create the table
    EXECUTE format('
        CREATE TABLE availability_addon_%s (
            datum DATE PRIMARY KEY,
            "0" INTEGER,
            "15" INTEGER,
            "30" INTEGER,
            "45" INTEGER,
            "60" INTEGER,
            "75" INTEGER,
            "90" INTEGER,
            "105" INTEGER,
            "120" INTEGER,
            "135" INTEGER,
            "150" INTEGER,
            "165" INTEGER,
            "180" INTEGER,
            "195" INTEGER,
            "210" INTEGER,
            "225" INTEGER,
            "240" INTEGER,
            "255" INTEGER,
            "270" INTEGER,
            "285" INTEGER,
            "300" INTEGER,
            "315" INTEGER,
            "330" INTEGER,
            "345" INTEGER,
            "360" INTEGER,
            "375" INTEGER,
            "390" INTEGER,
            "405" INTEGER,
            "420" INTEGER,
            "435" INTEGER,
            "450" INTEGER,
            "465" INTEGER,
            "480" INTEGER,
            "495" INTEGER,
            "510" INTEGER,
            "525" INTEGER,
            "540" INTEGER,
            "555" INTEGER,
            "570" INTEGER,
            "585" INTEGER,
            "600" INTEGER,
            "615" INTEGER,
            "630" INTEGER,
            "645" INTEGER,
            "660" INTEGER,
            "675" INTEGER,
            "690" INTEGER,
            "705" INTEGER,
            "720" INTEGER,
            "735" INTEGER,
            "750" INTEGER,
            "765" INTEGER,
            "780" INTEGER,
            "795" INTEGER,
            "810" INTEGER,
            "825" INTEGER,
            "840" INTEGER,
            "855" INTEGER,
            "870" INTEGER,
            "885" INTEGER,
            "900" INTEGER,
            "915" INTEGER,
            "930" INTEGER,
            "945" INTEGER,
            "960" INTEGER,
            "975" INTEGER,
            "990" INTEGER,
            "1005" INTEGER,
            "1020" INTEGER,
            "1035" INTEGER,
            "1050" INTEGER,
            "1065" INTEGER,
            "1080" INTEGER,
            "1095" INTEGER,
            "1110" INTEGER,
            "1125" INTEGER,
            "1140" INTEGER,
            "1155" INTEGER,
            "1170" INTEGER,
            "1185" INTEGER,
            "1200" INTEGER,
            "1215" INTEGER,
            "1230" INTEGER,
            "1245" INTEGER,
            "1260" INTEGER,
            "1275" INTEGER,
            "1290" INTEGER,
            "1305" INTEGER,
            "1320" INTEGER,
            "1335" INTEGER,
            "1350" INTEGER,
            "1365" INTEGER,
            "1380" INTEGER,
            "1395" INTEGER,
            "1410" INTEGER,
            "1425" INTEGER,
            "1440" INTEGER
        )',
        NEW.id
    );

    -- Enable RLS
    EXECUTE format('ALTER TABLE availability_addon_%s ENABLE ROW LEVEL SECURITY', NEW.id);

    -- Create RLS policy to allow SELECT for all
    EXECUTE format('
        CREATE POLICY "Allow all select on availability_addon_%s"
        ON availability_addon_%s
        FOR SELECT
        TO PUBLIC
        USING (true)',
        NEW.id, NEW.id
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to generate availability tables
CREATE TRIGGER create_addon_availability_table_trigger
AFTER INSERT ON addons
FOR EACH ROW
EXECUTE FUNCTION create_addon_availability_table();

-- Create connection table for experience, start location, product, and addon
CREATE TABLE experience_start_location_products_addons (
    id SERIAL PRIMARY KEY,
    experience_id INTEGER REFERENCES experiences(id),
    start_location_id INTEGER REFERENCES start_locations(id),
    product_id INTEGER REFERENCES products(id),
    addon_id INTEGER NOT NULL REFERENCES addons(id),
    price INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX idx_eslpa_experience_id ON experience_start_location_products_addons(experience_id);
CREATE INDEX idx_eslpa_start_location_id ON experience_start_location_products_addons(start_location_id);
CREATE INDEX idx_eslpa_product_id ON experience_start_location_products_addons(product_id);
CREATE INDEX idx_eslpa_addon_id ON experience_start_location_products_addons(addon_id);

-- Sample insert statements for testing
-- Insert an addon
INSERT INTO addons (name, description, total_quantity, image_url)
VALUES ('Lunch Package', 'Includes sandwich, fruit, and water', 50, 'https://example.com/lunch.jpg');

-- Connect addon to an experience (global addon for experience)
INSERT INTO experience_start_location_products_addons 
(experience_id, start_location_id, product_id, addon_id, price)
VALUES 
(1, NULL, NULL, 1, 150);

-- Connect addon to a location (global addon for location)
INSERT INTO experience_start_location_products_addons 
(experience_id, start_location_id, product_id, addon_id, price)
VALUES 
(NULL, 1, NULL, 1, 150);

-- Connect addon to a specific experience and location
INSERT INTO experience_start_location_products_addons 
(experience_id, start_location_id, product_id, addon_id, price)
VALUES 
(1, 1, NULL, 1, 150);

-- Connect addon to a specific product (globally available with this product)
INSERT INTO experience_start_location_products_addons 
(experience_id, start_location_id, product_id, addon_id, price)
VALUES 
(NULL, NULL, 1, 1, 150);

-- Connect addon to a specific product in a specific experience
INSERT INTO experience_start_location_products_addons 
(experience_id, start_location_id, product_id, addon_id, price)
VALUES 
(1, NULL, 1, 1, 150);

-- Connect addon to a specific product in a specific location
INSERT INTO experience_start_location_products_addons 
(experience_id, start_location_id, product_id, addon_id, price)
VALUES 
(NULL, 1, 1, 1, 150);

-- Connect addon to a specific product in a specific experience and location
INSERT INTO experience_start_location_products_addons 
(experience_id, start_location_id, product_id, addon_id, price)
VALUES 
(1, 1, 1, 1, 150); 