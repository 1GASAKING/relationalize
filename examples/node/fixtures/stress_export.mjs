// Shared fixture for the Node examples.
//
// This is the exact same combined RTDB export used by
// `examples/rtdb_conversion_test.py`, exercising every "ugly" case:
//
//   1. Records stored under Firebase keys (data lost if we don't inject the key)
//   2. Keyed maps used instead of real arrays (orders/items/account settings)
//   3. Sibling records with differing/schema-sparse columns
//   4. Same field with different types across records -> choice columns
//   5. Deeply nested ordinary objects (address.geo)
//   6. Nested grouped children (users.u1.orders.items)
//   7. Arrays of primitives, arrays of objects, nested arrays
//   8. null / missing values
//   9. Same path switching between object and primitive
//  10. Multiple top-level collections with their own child collections
//  11. Keyed maps whose *values* are primitives (presence sets)
//  12. Business-ID keyed maps (non push "-" style keys, ex CS101 course map)
//  13. 3-way mixed-type fields (int / float / str)
//  14. Reserved key collision (source record already has "record_id")
//  15. Special characters in record field names
//  16. Empty collections ({}) handled gracefully

// Fields that are RTDB "collections" whose keys are NOT necessarily push ids.
// Values are kept as keyed maps only when the field-name matches one of these
// (or when the keys themselves look like push ids "-...").
export const KNOWN_COLLECTION_FIELDS = [
  'orders',
  'items',
  'account_settings',
  'preferences',
  'enrolled_courses',
  'followers',
  'friends',
  'posts',
];

export const RTDB_EXPORT = {
  users: {
    // u1: full featured record
    u1: {
      name: 'Alice',
      age: 30,
      email: null,
      settings: { color: 'red', notifications: true },
      address: {
        city: 'NYC',
        geo: { lat: 40.7, lng: -74.0 },
      },
      tags: ['red', 'blue'],
      friends: [
        { id: 'u2', since: 2020 },
        { id: 'u3', since: 2021 },
      ],
      matrix: [
        [1, 2],
        [3, 4],
      ],
      orders: {
        '-o1': {
          order_id: 'ORD-1',
          items: {
            '-i1': { sku: 'BOOK-1', qty: 1 },
            '-i2': { sku: 'PEN-2', qty: 3 },
          },
        },
      },
    },
    // u2: same field different type (age str), extra sparse column (height),
    //     and settings *switches* from object to a plain string
    u2: {
      name: 'Bob',
      age: 'thirty',
      height: 180,
      settings: 'dark',
      orders: {},
    },
    // u3: sparse/parallel schema (nickname instead of age/email/etc.)
    //     plus test field-names with spaces, dashes and underscores
    u3: {
      name: 'Cara',
      nickname: 'CC',
      'contact email': 'cara@cc.com',
      'phone-number': '+123456',
      GH_I_: 'underscore-key',
    },
    // u4: keyed map with primitive values (RTDB presence set)
    u4: {
      name: 'Devon',
      followers: { u1: true, u5: true },
    },
    // u5: business-ID keyed collection (no "-" prefix in keys)
    u5: {
      name: 'Eve',
      enrolled_courses: {
        CS101: { grade: 'A' },
        MATH200: { grade: 'B' },
        PHYS150: { grade: 'A' },
      },
    },
    // u6: reserved-key collision: RTDB map key is "u6", payload already
    //     contains its own "record_id". Artificial id must not be lost.
    u6: {
      record_id: 'custom-u6-payload-id',
      name: 'Frank',
      score: 8.5, // float
    },
    // u7/u8: 3-way mixed type on the same column (float / int / str)
    u7: {
      name: 'Grace',
      score: 7, // int
    },
    u8: {
      name: 'Heidi',
      score: 'high', // str
      status: 'active',
    },
  },
  accounts: {
    // acc_1: fully featured account with two nested collections.
    acc_1: {
      owner: 'Alice',
      active: true,
      account_settings: {
        '-s1': { name: 'theme', value: 'dark' },
        '-s2': { name: 'language', value: 'en' },
      },
      preferences: {
        '-p1': { key: 'newsletter', enabled: true },
        '-p2': { key: 'weekly_digest', enabled: false },
      },
    },
    // acc_2: settings values sometimes become objects (path switch),
    //        preferences is an empty keyed collection.
    acc_2: {
      owner: 'Bob',
      active: false,
      account_settings: {
        '-s1': {
          name: 'theme',
          value: { mode: 'light', font_size: 14 },
        },
        '-s3': { name: 'auto_play', value: true },
      },
      preferences: {},
    },
    // acc_3: sparse sibling and a mixed-type preference value.
    acc_3: {
      owner: 'Cara',
      active: true,
      account_settings: {},
      preferences: {
        '-p1': { key: 'digest', enabled: 'yes' },
      },
    },
  },
  devices: {
    dev_1: { serial: 'DEV-ABC-0001', owner_ref: 'u1', revision: 3 },
    dev_2: { serial: 'DEV-XYZ-0002', owner_ref: 'u4', revision: 'v2' },
    dev_3: { serial: null, owner_ref: 'u8' },
  },
};
