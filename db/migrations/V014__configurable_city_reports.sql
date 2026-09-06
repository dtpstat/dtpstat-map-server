SET SEARCH_PATH = BUSLANES, PUBLIC;

CREATE TABLE IF NOT EXISTS BUSLANES.REPORT_CONFIG
(
    ID              SMALLINT PRIMARY KEY DEFAULT 1 CHECK (ID = 1),
    METRICS         JSONB       NOT NULL CHECK (JSONB_TYPEOF(METRICS) = 'array'),
    TABLE_COLUMNS   JSONB       NOT NULL CHECK (JSONB_TYPEOF(TABLE_COLUMNS) = 'array'),
    CSV_COLUMNS     JSONB       NOT NULL CHECK (JSONB_TYPEOF(CSV_COLUMNS) = 'array'),
    RANK_METRIC_KEY TEXT        NOT NULL,
    RANK_DIRECTION  TEXT        NOT NULL CHECK (RANK_DIRECTION IN ('asc', 'desc')),
    UPDATED_AT      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS BUSLANES.CITY_REPORT_VALUES
(
    CITY_ID     BIGINT PRIMARY KEY REFERENCES BUSLANES.CITIES (ID) ON DELETE CASCADE,
    VALUES      JSONB            NOT NULL DEFAULT '{}'::JSONB CHECK (JSONB_TYPEOF(VALUES) = 'object'),
    RANK_VALUE  DOUBLE PRECISION,
    RANK        INTEGER CHECK (RANK IS NULL OR RANK > 0),
    UPDATED_AT  TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

INSERT INTO BUSLANES.REPORT_CONFIG
(
    ID,
    METRICS,
    TABLE_COLUMNS,
    CSV_COLUMNS,
    RANK_METRIC_KEY,
    RANK_DIRECTION
)
VALUES
(
    1,
    $$[
      {
        "key":"lane_length_m",
        "name":"Длина ВП",
        "source":{"kind":"aggregate","field":"geometry.lane_length_m","aggregate":"sum","groupBy":"none"},
        "operations":[]
      },
      {
        "key":"population",
        "name":"Население",
        "source":{"kind":"field","field":"city.population"},
        "operations":[]
      },
      {
        "key":"lane_m_per_1000",
        "name":"ВП на 1000 жителей",
        "source":{"kind":"aggregate","field":"geometry.lane_length_m","aggregate":"sum","groupBy":"none"},
        "operations":[
          {"operator":"divide","operand":{"kind":"field","field":"city.population"}},
          {"operator":"multiply","operand":{"kind":"constant","value":1000}}
        ]
      }
    ]$$::JSONB,
    $$[
      {"kind":"rank","title":"№"},
      {"kind":"city","title":"город"},
      {"kind":"metric","metricKey":"lane_length_m","title":"длина ВП (км)","scale":0.001,"decimals":1},
      {"kind":"metric","metricKey":"population","title":"жители (тыс.)","scale":0.001,"decimals":0},
      {"kind":"metric","metricKey":"lane_m_per_1000","title":"ВП (м/1000 чел.)","scale":1,"decimals":1}
    ]$$::JSONB,
    $$[
      {"kind":"city","title":"short_name"},
      {"kind":"metric","metricKey":"lane_length_m","title":"lanes_length","scale":1,"decimals":null},
      {"kind":"metric","metricKey":"population","title":"population","scale":1,"decimals":null},
      {"kind":"metric","metricKey":"lane_m_per_1000","title":"lanes_per_1K","scale":1,"decimals":null},
      {"kind":"minx","title":"minx"},
      {"kind":"miny","title":"miny"},
      {"kind":"maxx","title":"maxx"},
      {"kind":"maxy","title":"maxy"}
    ]$$::JSONB,
    'lane_m_per_1000',
    'desc'
)
ON CONFLICT (ID) DO NOTHING;

INSERT INTO BUSLANES.CITY_REPORT_VALUES (CITY_ID, VALUES, RANK_VALUE, RANK, UPDATED_AT)
SELECT
    city.ID,
    JSONB_BUILD_OBJECT(
        'lane_length_m', city.LANE_LENGTH_M,
        'population', population.POPULATION,
        'lane_m_per_1000', city.LANE_M_PER_1000
    ),
    city.LANE_M_PER_1000,
    ROW_NUMBER() OVER (
        PARTITION BY city.IS_LARGE
        ORDER BY city.LANE_M_PER_1000 DESC NULLS LAST, city.NAME ASC
    )::INTEGER,
    NOW()
FROM BUSLANES.CITIES AS city
LEFT JOIN BUSLANES.CITY_POPULATIONS AS population ON population.CITY_ID = city.ID
ON CONFLICT (CITY_ID) DO UPDATE SET
    VALUES = EXCLUDED.VALUES,
    RANK_VALUE = EXCLUDED.RANK_VALUE,
    RANK = EXCLUDED.RANK,
    UPDATED_AT = NOW();

CREATE INDEX IF NOT EXISTS CITY_REPORT_VALUES_RANK_IDX
    ON BUSLANES.CITY_REPORT_VALUES (RANK);

COMMENT ON TABLE BUSLANES.REPORT_CONFIG IS
    'Declarative safe report definition used by the public ranking table and static CSV export.';
COMMENT ON TABLE BUSLANES.CITY_REPORT_VALUES IS
    'Materialized per-city scalar metric values produced from REPORT_CONFIG after data updates.';
