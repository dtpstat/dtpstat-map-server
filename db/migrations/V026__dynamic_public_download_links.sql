SET SEARCH_PATH = BUSLANES, PUBLIC;

UPDATE PROJECT_SETTINGS
SET
    FOOTER_HTML = REPLACE(
        REPLACE(
            REPLACE(
                REPLACE(
                    FOOTER_HTML,
                    'href="/bus-lanes.geojson"',
                    'href="{{PUBLIC_GEOJSON_URL}}"'
                ),
                'href=''/bus-lanes.geojson''',
                'href=''{{PUBLIC_GEOJSON_URL}}'''
            ),
            'href="/bus-lanes.csv"',
            'href="{{PUBLIC_CSV_URL}}"'
        ),
        'href=''/bus-lanes.csv''',
        'href=''{{PUBLIC_CSV_URL}}'''
    ),
    UPDATED_AT = NOW()
WHERE FOOTER_HTML LIKE '%/bus-lanes.geojson%'
   OR FOOTER_HTML LIKE '%/bus-lanes.csv%';

COMMENT ON COLUMN PROJECT_SETTINGS.PUBLIC_DOWNLOAD_NAME IS
    'Base name used for materialized public GeoJSON/CSV files, URLs and download names; extensions are appended by the application.';
