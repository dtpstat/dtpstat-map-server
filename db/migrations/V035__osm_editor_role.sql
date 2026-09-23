SET SEARCH_PATH = BUSLANES, PUBLIC;

ALTER TABLE BUSLANES.ADMIN_USERS
    ADD COLUMN IF NOT EXISTS CAN_EDIT_OSM BOOLEAN NOT NULL DEFAULT FALSE;

-- Before this permission existed, OSM object editing was available through the
-- broad data-management permission. Preserve that access during the upgrade;
-- future changes are controlled by the dedicated role.
UPDATE BUSLANES.ADMIN_USERS
SET CAN_EDIT_OSM = TRUE,
    UPDATED_AT = NOW()
WHERE CAN_MANAGE_DATA
   OR IS_SUPERUSER
   OR IS_BOOTSTRAP;

COMMENT ON COLUMN BUSLANES.ADMIN_USERS.CAN_EDIT_OSM IS
    'Allows access to the OSM object tree editor independently of data import permissions.';
