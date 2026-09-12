-- accounts (3 rows)
CREATE TABLE IF NOT EXISTS "public"."accounts" (
    "account_settings" VARCHAR(65535)
    , "active" BOOLEAN
    , "owner" VARCHAR(65535)
    , "preferences" VARCHAR(65535)
    , "record_id" VARCHAR(65535)
);

-- accounts_account_settings (4 rows)
CREATE TABLE IF NOT EXISTS "public"."accounts_account_settings" (
    "account_settings__index_" BIGINT
    , "account_settings__rid_" VARCHAR(65535)
    , "account_settings_name" VARCHAR(65535)
    , "account_settings_record_id" VARCHAR(65535)
    , "account_settings_value_bool" BOOLEAN
    , "account_settings_value_font_size" BIGINT
    , "account_settings_value_mode" VARCHAR(65535)
    , "account_settings_value_str" VARCHAR(65535)
);

-- accounts_preferences (3 rows)
CREATE TABLE IF NOT EXISTS "public"."accounts_preferences" (
    "preferences__index_" BIGINT
    , "preferences__rid_" VARCHAR(65535)
    , "preferences_enabled_bool" BOOLEAN
    , "preferences_enabled_str" VARCHAR(65535)
    , "preferences_key" VARCHAR(65535)
    , "preferences_record_id" VARCHAR(65535)
);

-- devices (3 rows)
CREATE TABLE IF NOT EXISTS "public"."devices" (
    "owner_ref" VARCHAR(65535)
    , "record_id" VARCHAR(65535)
    , "revision_int" BIGINT
    , "revision_str" VARCHAR(65535)
    , "serial" VARCHAR(65535)
);

-- users (8 rows)
CREATE TABLE IF NOT EXISTS "public"."users" (
    "GH_I_" VARCHAR(65535)
    , "address_city" VARCHAR(65535)
    , "address_geo_lat" FLOAT
    , "address_geo_lng" BIGINT
    , "age_int" BIGINT
    , "age_str" VARCHAR(65535)
    , "contact email" VARCHAR(65535)
    , "enrolled_courses" VARCHAR(65535)
    , "followers" VARCHAR(65535)
    , "friends" VARCHAR(65535)
    , "height" BIGINT
    , "matrix" VARCHAR(65535)
    , "name" VARCHAR(65535)
    , "nickname" VARCHAR(65535)
    , "orders" VARCHAR(65535)
    , "phone-number" VARCHAR(65535)
    , "record_id" VARCHAR(65535)
    , "score_float" FLOAT
    , "score_int" BIGINT
    , "score_str" VARCHAR(65535)
    , "settings" VARCHAR(65535)
    , "settings_color" VARCHAR(65535)
    , "settings_notifications" BOOLEAN
    , "source_record_id" VARCHAR(65535)
    , "status" VARCHAR(65535)
    , "tags" VARCHAR(65535)
);

-- users_enrolled_courses (3 rows)
CREATE TABLE IF NOT EXISTS "public"."users_enrolled_courses" (
    "enrolled_courses__index_" BIGINT
    , "enrolled_courses__rid_" VARCHAR(65535)
    , "enrolled_courses_grade" VARCHAR(65535)
    , "enrolled_courses_record_id" VARCHAR(65535)
);

-- users_followers (2 rows)
CREATE TABLE IF NOT EXISTS "public"."users_followers" (
    "followers__index_" BIGINT
    , "followers__rid_" VARCHAR(65535)
    , "followers_record_id" VARCHAR(65535)
    , "followers_value" BOOLEAN
);

-- users_friends (2 rows)
CREATE TABLE IF NOT EXISTS "public"."users_friends" (
    "friends__index_" BIGINT
    , "friends__rid_" VARCHAR(65535)
    , "friends_id" VARCHAR(65535)
    , "friends_since" BIGINT
);

-- users_matrix (2 rows)
CREATE TABLE IF NOT EXISTS "public"."users_matrix" (
    "matrix__index_" BIGINT
    , "matrix__rid_" VARCHAR(65535)
    , "matrix__val_" VARCHAR(65535)
);

-- users_matrix__val_ (4 rows)
CREATE TABLE IF NOT EXISTS "public"."users_matrix__val_" (
    "matrix__val___index_" BIGINT
    , "matrix__val___rid_" VARCHAR(65535)
    , "matrix__val___val_" BIGINT
);

-- users_orders (1 rows)
CREATE TABLE IF NOT EXISTS "public"."users_orders" (
    "orders__index_" BIGINT
    , "orders__rid_" VARCHAR(65535)
    , "orders_items" VARCHAR(65535)
    , "orders_order_id" VARCHAR(65535)
    , "orders_record_id" VARCHAR(65535)
);

-- users_orders_items (2 rows)
CREATE TABLE IF NOT EXISTS "public"."users_orders_items" (
    "orders_items__index_" BIGINT
    , "orders_items__rid_" VARCHAR(65535)
    , "orders_items_qty" BIGINT
    , "orders_items_record_id" VARCHAR(65535)
    , "orders_items_sku" VARCHAR(65535)
);

-- users_tags (2 rows)
CREATE TABLE IF NOT EXISTS "public"."users_tags" (
    "tags__index_" BIGINT
    , "tags__rid_" VARCHAR(65535)
    , "tags__val_" VARCHAR(65535)
);
