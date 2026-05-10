-- Deterministic bootstrap data only.
-- Runtime/user-generated rows stay in the live database and are intentionally
-- excluded from migrations. Model rows are intentionally not seeded here:
-- operators should sync their existing New API gateway from the admin console
-- with a deploy-network URL such as http://model-gateway:3000.

BEGIN;

-- Default admin account:
-- account: admin
-- password: admin123
WITH admin_seed AS (
    SELECT
        'admin@163.com'::TEXT AS email,
        'admin'::TEXT AS name,
        '$2a$10$c.57yAjkgO031eInR.91Vurdh9BZm2re7OrWk2Gx06tlngnJdyMYi'::TEXT AS password_hash,
        'admin'::TEXT AS role
)
UPDATE users
SET
    password_hash = admin_seed.password_hash,
    role = admin_seed.role,
    updated_at = NOW()
FROM admin_seed
WHERE LOWER(users.name) = LOWER(admin_seed.name);

WITH admin_seed AS (
    SELECT
        'admin@163.com'::TEXT AS email,
        'admin'::TEXT AS name,
        '$2a$10$c.57yAjkgO031eInR.91Vurdh9BZm2re7OrWk2Gx06tlngnJdyMYi'::TEXT AS password_hash,
        'admin'::TEXT AS role
)
INSERT INTO users (email, name, password_hash, role)
SELECT
    admin_seed.email,
    admin_seed.name,
    admin_seed.password_hash,
    admin_seed.role
FROM admin_seed
WHERE NOT EXISTS (
    SELECT 1
    FROM users
    WHERE LOWER(name) = LOWER(admin_seed.name)
);

COMMIT;
