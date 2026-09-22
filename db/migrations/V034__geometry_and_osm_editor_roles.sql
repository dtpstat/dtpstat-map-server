SET SEARCH_PATH = BUSLANES, PUBLIC;

ALTER TABLE BUSLANES.ADMIN_USERS
    ADD COLUMN IF NOT EXISTS CAN_EDIT_GEOMETRIES BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS CAN_EDIT_OSM BOOLEAN NOT NULL DEFAULT FALSE;

-- Preserve access existing data administrators had before these permissions
-- became independent. Future changes are controlled by their own role toggles.
UPDATE BUSLANES.ADMIN_USERS
SET CAN_EDIT_GEOMETRIES = TRUE,
    CAN_EDIT_OSM = TRUE,
    UPDATED_AT = NOW()
WHERE CAN_MANAGE_DATA
   OR IS_SUPERUSER
   OR IS_BOOTSTRAP;

COMMENT ON COLUMN BUSLANES.ADMIN_USERS.CAN_EDIT_GEOMETRIES IS
    'Allows access to the dedicated geometry editor and its mutation API.';
COMMENT ON COLUMN BUSLANES.ADMIN_USERS.CAN_EDIT_OSM IS
    'Allows access to the OSM object tree editor independently of data import permissions.';
