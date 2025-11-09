const SAMPLE_TRANSACTIONS = [
  {
    id: 1,
    bookingDate: '2025-09-13',
    title: '/OPF/IN/.../CO-PROF 13/2025',
    proforma: 'CO-PROF 13/2025',
    amount: 1055.0,
    status: 'matched',
  },
  {
    id: 2,
    bookingDate: '2025-09-16',
    title: 'CO-PROF 16/2025',
    proforma: 'CO-PROF 16/2025',
    amount: 2556.0,
    status: 'matched',
  },
  {
    id: 3,
    bookingDate: '2025-09-18',
    title: 'NY2026',
    proforma: null,
    amount: 1279.58,
    status: 'manual',
    reason: 'no_proforma',
  },
  {
    id: 4,
    bookingDate: '2025-09-25',
    title: 'CO-PROF 19/2025.',
    proforma: 'CO-PROF 19/2025',
    amount: 638.9,
    status: 'partial',
    difference: -361.1,
  },
];

const SAMPLE_REPORT = [
  {
    product: 'Camp Spain',
    month: '2025-09',
    expected: 3200,
    actual: 3310,
    difference: 110,
    status: 'paid',
  },
  {
    product: 'Camp Tenerife',
    month: '2025-09',
    expected: 2000,
    actual: 1600,
    difference: -400,
    status: 'partial',
  },
];

const SAMPLE_MANUAL = [
  {
    id: 3,
    bookingDate: '2025-09-18',
    title: 'NY2026',
    amount: 1279.58,
    reason: 'no_proforma',
  },
  {
    id: 5,
    bookingDate: '2025-09-30',
    title: '48',
    amount: 3415.04,
    reason: 'no_proforma',
  },
];


