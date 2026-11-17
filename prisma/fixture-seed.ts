import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { Prisma, prisma } from "@/lib/prisma";
import { SYSTEM_ROLE_DEFAULTS } from "@/lib/roles/system-roles";

type SeedDb = typeof prisma;

const SEED_DATE = new Date("2026-09-09T00:00:00+08:00");
const SEED_PASSWORD = "CarServiceTest123!";
const orderStatuses = [
  "COMPLETED",
  "COMPLETED",
  "IN_PROGRESS",
  "IN_PROGRESS",
  "SCHEDULED",
  "CANCELLED",
] as const;
const appointmentStatuses = [
  "PENDING",
  "CONFIRMED",
  "REJECTED",
  "CANCELLED",
  "NO_SHOW",
  "CONFIRMED",
] as const;

const tenants = [
  {
    id: "seed-tenant-ub-auto",
    slug: "ub-auto-service",
    name: "УБ Авто Сервис",
    registerNumber: "9012345",
    email: "ubauto@carservice.mn",
    phone1: "77112233",
    phone2: "99112233",
    plan: "BUSINESS" as const,
    acceptsOnlineBooking: true,
  },
  {
    id: "seed-tenant-steppe",
    slug: "steppe-motors",
    name: "Степп Моторс",
    registerNumber: "9023456",
    email: "steppe@carservice.mn",
    phone1: "77004567",
    phone2: "99004567",
    plan: "ENTERPRISE" as const,
    acceptsOnlineBooking: true,
  },
  {
    id: "seed-tenant-darkhan",
    slug: "darkhan-motors",
    name: "Дархан Моторс",
    registerNumber: "9034567",
    email: "darkhan@carservice.mn",
    phone1: "70371234",
    phone2: "99371234",
    plan: "BUSINESS" as const,
    acceptsOnlineBooking: true,
  },
  {
    id: "seed-tenant-erdenet",
    slug: "erdenet-garage",
    name: "Эрдэнэт Гараж",
    registerNumber: "9045678",
    email: "erdenet@carservice.mn",
    phone1: "70351234",
    phone2: "99351234",
    plan: "FREE" as const,
    acceptsOnlineBooking: false,
  },
];

const branchSeed = [
  [
    ["Төв салбар", "Баянзүрх", "6-р хороо", "Нарны зам 12, Авто плаза 2", 47.9187, 106.9391],
    ["Яармаг салбар", "Хан-Уул", "24-р хороо", "Наадамчдын зам 45", 47.8658, 106.8079],
    ["3-р хороолол салбар", "Баянгол", "5-р хороо", "Энхтайвны өргөн чөлөө 88", 47.9083, 106.8746],
  ],
  [
    ["Сүхбаатар салбар", "Сүхбаатар", "8-р хороо", "Сөүлийн гудамж 17", 47.9173, 106.9177],
    ["Хархорин салбар", "Баянгол", "20-р хороо", "Москва хорооллын зам", 47.8996, 106.8266],
  ],
  [
    ["Дархан төв", "Дархан-Уул", "14-р баг", "Үйлдвэрийн бүс 4", 49.4867, 105.9228],
    ["Дархан шинэ зах", "Дархан-Уул", "15-р баг", "Шинэ Дархан авто зах", 49.4759, 105.9461],
  ],
  [
    ["Эрдэнэт төв", "Орхон", "Баян-Өндөр сум", "Залуучуудын өргөн чөлөө 21", 49.0278, 104.0445],
    ["Уурхайчин салбар", "Орхон", "Баян-Өндөр сум", "Уурхайчин 3-р хороолол", 49.0342, 104.0624],
  ],
] as const;

const accountNames = [
  ["Батзориг", "Эрдэнэ", "99110001"],
  ["Саруул", "Мөнхбат", "99110002"],
  ["Анужин", "Батсайхан", "99110003"],
  ["Тэмүүлэн", "Ганзориг", "99110004"],
  ["Номин", "Даваасүрэн", "99110005"],
  ["Мөнх-Оргил", "Болд", "99110006"],
  ["Энхжин", "Лхагва", "99110007"],
  ["Гарьд", "Отгонбаатар", "99110008"],
  ["Хулан", "Төгөлдөр", "99110009"],
  ["Билгүүн", "Цэрэн", "99110010"],
  ["Оюундарь", "Баяр", "99110011"],
  ["Мягмар", "Сүхбат", "99110012"],
  ["Дөлгөөн", "Жаргал", "99110013"],
  ["Золбоо", "Нямдорж", "99110014"],
  ["Ариунаа", "Очир", "99110015"],
  ["Батсүх", "Алтангэрэл", "99110016"],
  ["Уянга", "Батболд", "99110017"],
  ["Төгсөө", "Чулуун", "99110018"],
  ["Мишээл", "Ганбаатар", "99110019"],
  ["Эрдэнэсайхан", "Баттулга", "99110020"],
  ["Солонго", "Отгон", "99110021"],
  ["Баянмөнх", "Дорж", "99110022"],
  ["Цэлмэг", "Мөнхөө", "99110023"],
  ["Наран", "Энхтөр", "99110024"],
] as const;

const vehicleSeed = [
  ["1234УБА", "Toyota", "Prius", 2014, 84200, "Бензин-цахилгаан", "Зүүн", "Цагаан", 1798, "Суудал"],
  ["5678УБВ", "Toyota", "Land Cruiser 200", 2018, 126500, "Бензин", "Зүүн", "Хар", 4608, "Суудал"],
  ["2468УНТ", "Honda", "Fit", 2012, 156800, "Бензин", "Баруун", "Саарал", 1339, "Суудал"],
  ["1357УБМ", "Subaru", "Forester", 2017, 98300, "Бензин", "Зүүн", "Хөх", 1995, "Суудал"],
  ["8080УБР", "Toyota", "Aqua", 2016, 111200, "Бензин-цахилгаан", "Зүүн", "Улаан", 1496, "Суудал"],
  ["4321УБХ", "Lexus", "RX450h", 2015, 134400, "Бензин-цахилгаан", "Зүүн", "Цагаан", 3456, "Суудал"],
  ["7777УБТ", "Mercedes-Benz", "E300", 2019, 67400, "Бензин", "Зүүн", "Мөнгөлөг", 1991, "Суудал"],
  ["2020УБС", "Hyundai", "Porter II", 2020, 88400, "Дизель", "Зүүн", "Цагаан", 2497, "Ачаа"],
  ["9090УБН", "Kia", "Sorento", 2021, 45200, "Дизель", "Зүүн", "Хар", 2151, "Суудал"],
  ["3141УБГ", "Nissan", "X-Trail", 2015, 145900, "Бензин", "Зүүн", "Саарал", 1997, "Суудал"],
  ["2718УБД", "Mitsubishi", "Pajero", 2010, 198700, "Дизель", "Зүүн", "Ногоон", 3200, "Суудал"],
  ["1618УБЕ", "Toyota", "Harrier", 2020, 59300, "Бензин", "Зүүн", "Хар", 1986, "Суудал"],
  ["1122УБЗ", "BYD", "Song Plus", 2023, 18200, "Цахилгаан", "Зүүн", "Цэнхэр", 0, "Суудал"],
  ["3344УБИ", "Tesla", "Model 3", 2022, 26700, "Цахилгаан", "Зүүн", "Цагаан", 0, "Суудал"],
  ["5566УБК", "Toyota", "Hiace", 2013, 221400, "Дизель", "Зүүн", "Цагаан", 2982, "Ачаа"],
  ["7788УБЛ", "Volkswagen", "Tiguan", 2019, 76200, "Бензин", "Зүүн", "Хар", 1395, "Суудал"],
  ["9900УБП", "Mazda", "CX-5", 2018, 93200, "Бензин", "Зүүн", "Улаан", 2488, "Суудал"],
  ["1010УБФ", "Ford", "Ranger", 2021, 51800, "Дизель", "Зүүн", "Хөх", 1996, "Ачаа"],
  ["1212УБЦ", "Toyota", "RAV4", 2017, 107300, "Бензин", "Зүүн", "Мөнгөлөг", 1987, "Суудал"],
  ["3434УБЧ", "Honda", "CR-V", 2018, 88500, "Бензин", "Зүүн", "Цагаан", 1498, "Суудал"],
  ["5656УБШ", "Lexus", "NX300h", 2020, 47600, "Бензин-цахилгаан", "Зүүн", "Хар", 2494, "Суудал"],
  ["7878УБЩ", "Hyundai", "Staria", 2022, 34100, "Дизель", "Зүүн", "Цагаан", 2199, "Суудал"],
  ["2323УБЪ", "Suzuki", "Jimny", 2020, 38900, "Бензин", "Зүүн", "Шар", 1462, "Суудал"],
  ["4545УБЬ", "Nissan", "Leaf", 2019, 55400, "Цахилгаан", "Зүүн", "Цагаан", 0, "Суудал"],
] as const;

const categorySeed = [
  ["Тос, шингэн", "Хөдөлгүүрийн тос, шүүлтүүр, шингэн солих", 60],
  ["Тоормос", "Наклад, диск, суппорт болон тоормосны систем", 90],
  ["Хөдөлгүүр", "Хөдөлгүүрийн оношилгоо, засвар үйлчилгээ", 120],
  ["Явах эд анги", "Амортизатор, шарнир, рулын систем", 150],
  ["Цахилгаан", "Аккумулятор, стартер, генератор, компьютер", 90],
  ["Дугуй", "Дугуй солих, баланс, тэнхлэг тохиргоо", 45],
  ["Агааржуулалт", "Кондишн цэнэглэх, халаалт, агаарын систем", 90],
  ["Угаалга", "Гадна, дотор угаалга болон өнгөлгөө", 60],
] as const;

// Систем даяарх ажлын каталог (SystemServiceKey) — /discover болон мобайл
// "Захиалах" таб дээрх category-first picker-т ашиглагдана. Тенант бүрийн
// адил нэртэй Category мөрүүд бүгд яг нэг систем түлхүүрт заавал холбогдох
// тул `categorySeed`-тэй индексээрээ 1:1 тааруулав — прод дээрх жинхэнэ
// хэрэглээг илүү оновчтой дуурайхын тулд (өмнө нь бүгд ганц "Ерөнхий" рүү
// холбогддог байсан бөгөөд энэ нь service-key шүүлтийг ялгаагүй болгодог
// байсан).
const systemServiceKeySeed = [
  ["Тос солих", "Хөдөлгүүрийн тос, шүүлтүүр, шингэн солих ажил"],
  ["Тоормосны засвар", "Наклад, диск, суппорт болон тоормосны систем засвар"],
  ["Хөдөлгүүрийн засвар", "Хөдөлгүүрийн оношилгоо, засвар үйлчилгээ"],
  ["Явах эд ангийн засвар", "Амортизатор, шарнир, рулын системийн засвар"],
  ["Цахилгаан систем", "Аккумулятор, стартер, генератор, компьютер оношилгоо"],
  ["Дугуйн үйлчилгээ", "Дугуй солих, баланс, тэнхлэг тохиргоо"],
  ["Агааржуулалтын засвар", "Кондишн цэнэглэх, халаалт, агаарын систем"],
  ["Угаалга, өнгөлгөө", "Гадна, дотор угаалга болон өнгөлгөөний үйлчилгээ"],
] as const;

// Тенант бүр `categorySeed`-ийн ЯГ ИЖИЛ 8 ангиллыг өөр өөр идэвхтэй дэд
// олонлог, үргэлжлэх хугацаа, багтаамжаар авдаг — өмнө нь бүх тенант яг ижил
// (Угаалгаас бусад бүгд идэвхтэй, багтаамж 1, стандарт хугацаа) байсан тул
// /discover, /book-ийн service-key шүүлтүүр ямар ч ялгаа гаргадаггүй байв.
// `categoryIds`-ийн индекс тогтмол хэвээр (categorySeed-тэй 1:1) — зөвхөн
// `isActive`/`durationMinutes`/`concurrentCapacity`-г тенант тус бүрээр
// өөрчилнө, categorySeed индексээс хамаарсан бусад бүх код (serviceSeed,
// diagnostic template, appointment/order category сонголт) хэвээр ажиллана.
const tenantCategoryProfiles = [
  // 0: УБ Авто Сервис — том, ерөнхий газар: Угаалгаас бусад бүгдийг хийдэг.
  { inactive: new Set<number>([7]), durationFactor: 1, capacityBoost: new Set<number>() },
  // 1: Степп Моторс — тоормос/явах эд анги/дугуйны мэргэшсэн, түргэн газар.
  { inactive: new Set<number>([2, 4, 6, 7]), durationFactor: 0.85, capacityBoost: new Set<number>([1, 5]) },
  // 2: Дархан Моторс — хөдөлгүүр/цахилгааны мэргэжилтэн, нарийвчилсан (удаан).
  { inactive: new Set<number>([1, 3, 5, 6]), durationFactor: 1.15, capacityBoost: new Set<number>([2]) },
  // 3: Эрдэнэт Гараж — жижиг, түргэн үйлчилгээ: тос, дугуй, угаалга.
  { inactive: new Set<number>([1, 2, 3, 4, 6]), durationFactor: 0.75, capacityBoost: new Set<number>([0, 5, 7]) },
] as const;

const serviceSeed = [
  ["LABOR", "Хөдөлгүүрийн тос солих", "OIL-CHANGE", 85000, "Тос, шингэн", 45],
  ["LABOR", "Тоормосны наклад солих", "BRAKE-PAD", 180000, "Тоормос", 90],
  ["LABOR", "Явах эд анги бүрэн шалгах", "SUSPENSION-CHECK", 120000, "Явах эд анги", 120],
  ["LABOR", "Компьютер оношилгоо", "COMPUTER-DIAG", 80000, "Цахилгаан", 45],
  ["LABOR", "Дугуй баланс тохиргоо", "WHEEL-BALANCE", 60000, "Дугуй", 45],
  ["LABOR", "Кондишн цэнэглэх", "AC-REFILL", 150000, "Агааржуулалт", 90],
  ["GOODS", "0W-20 бүрэн синтетик тос", "OIL-0W20-4L", 185000, "Тос, шингэн", null],
  ["GOODS", "Тоормосны наклад — урд", "PAD-FRONT", 220000, "Тоормос", null],
  ["GOODS", "AGM аккумулятор 70Ah", "BATTERY-AGM70", 620000, "Цахилгаан", null],
  ["GOODS", "R16 өвлийн дугуй", "TIRE-R16-WINTER", 420000, "Дугуй", null],
  ["DIAGNOSTIC", "Ерөнхий компьютер оношилгоо", "DIAG-GENERAL", 80000, "Хөдөлгүүр", 60],
] as const;

const diagnosticSchema = {
  sections: [
    {
      id: "engine",
      title: "Хөдөлгүүрийн тасалгаа",
      items: [
        { id: "engine-oil", label: "Хөдөлгүүрийн тос", type: "check", options: ["Хэвийн", "Анхаарах", "Солих"] },
        { id: "coolant", label: "Хөргөлтийн шингэн", type: "check", options: ["Хэвийн", "Анхаарах", "Солих"] },
        { id: "engine-note", label: "Мэргэжилтний тайлбар", type: "text" },
      ],
    },
    {
      id: "chassis",
      title: "Явах эд анги, тоормос",
      items: [
        { id: "brake-pad", label: "Тоормосны наклад", type: "check", positionSet: "LR", options: ["Хэвийн", "Анхаарах", "Солих"] },
        { id: "tire-depth", label: "Дугуйн хээний гүн", type: "number" },
        { id: "chassis-photo", label: "Шалгалтын зураг", type: "photo" },
      ],
    },
    {
      id: "summary",
      title: "Дүгнэлт",
      items: [
        { id: "recommendation", label: "Зөвлөмж", type: "text" },
        { id: "customer-signature", label: "Үйлчлүүлэгчийн гарын үсэг", type: "signature" },
      ],
    },
  ],
};

function daysFrom(base: Date, days: number, hour: number, minute = 0): Date {
  const value = new Date(base);
  value.setDate(value.getDate() + days);
  value.setHours(hour, minute, 0, 0);
  return value;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function reportData(index: number): Prisma.InputJsonValue {
  const critical = index % 5 === 0;
  const warning = index % 2 === 0;
  return {
    "engine-oil": { value: critical ? "Солих" : warning ? "Анхаарах" : "Хэвийн", note: warning ? "Тосны өнгө бараан болсон." : null, photos: [] },
    coolant: { value: "Хэвийн", photos: [] },
    "engine-note": { value: critical ? "Тосны шүүрэл бага хэмжээгээр илэрсэн." : "Хэвийн ажиллагаатай.", photos: [] },
    "brake-pad@L": { value: critical ? "Солих" : "Хэвийн", photos: [] },
    "brake-pad@R": { value: warning ? "Анхаарах" : "Хэвийн", photos: [] },
    "tire-depth": { value: critical ? 2.1 : 5.4, note: "мм", photos: [] },
    "chassis-photo": {
      value: null,
      photos: ["https://placehold.co/640x420/png?text=CarService+Inspection"],
    },
    recommendation: {
      value: critical ? "Тоормосны наклад болон тосны шүүрлийг ойрын хугацаанд засварлана уу." : "Дараагийн төлөвлөгөөт үйлчилгээг 5,000 км-ийн дараа хийлгэнэ үү.",
      photos: [],
    },
    "customer-signature": {
      value: "https://placehold.co/640x220/png?text=Customer+Signature",
      photos: [],
    },
  };
}

async function seedPlans(db: SeedDb) {
  const prices = [
    ["FREE", "MONTH", 0], ["FREE", "YEAR", 0],
    ["BUSINESS", "MONTH", 149000], ["BUSINESS", "QUARTER", 399000], ["BUSINESS", "YEAR", 1390000],
    ["ENTERPRISE", "MONTH", 399000], ["ENTERPRISE", "QUARTER", 1090000], ["ENTERPRISE", "YEAR", 3890000],
  ] as const;
  const priceIds = new Map<string, string>();
  for (const [plan, period, amount] of prices) {
    const id = `seed-plan-price-${plan.toLowerCase()}-${period.toLowerCase()}`;
    priceIds.set(`${plan}:${period}`, id);
    await db.planPrice.upsert({
      where: { plan_period_currency: { plan, period, currency: "MNT" } },
      update: { amount, isActive: true, notes: "Seed fixture — бодит үнэ биш." },
      create: { id, plan, period, amount, currency: "MNT", isActive: true, notes: "Seed fixture — бодит үнэ биш." },
    });
  }

  const features = [
    ["FREE", "Салбарын тоо", "1", false], ["FREE", "Онлайн цаг захиалга", "Тийм", true],
    ["BUSINESS", "Салбарын тоо", "5", true], ["BUSINESS", "Ажилтны тоо", "20", false], ["BUSINESS", "Оношилгооны хуудас", "Тийм", true],
    ["ENTERPRISE", "Салбарын тоо", "Хязгааргүй", true], ["ENTERPRISE", "Ажилтны тоо", "Хязгааргүй", true], ["ENTERPRISE", "Тайлан ба аудит", "Тийм", true],
  ] as const;
  for (let i = 0; i < features.length; i++) {
    const [plan, label, value, highlighted] = features[i];
    await db.planFeature.upsert({
      where: { id: `seed-plan-feature-${i + 1}` },
      update: { plan, label, value, highlighted, sortOrder: i },
      create: { id: `seed-plan-feature-${i + 1}`, plan, label, value, highlighted, sortOrder: i },
    });
  }

  const limits = [
    ["FREE", "max_users", "Ажилтны дээд тоо", 3, "COUNT"],
    ["BUSINESS", "max_users", "Ажилтны дээд тоо", 20, "COUNT"],
    ["ENTERPRISE", "max_users", "Ажилтны дээд тоо", null, "COUNT"],
    ["FREE", "online_booking", "Онлайн цаг захиалга", null, "BOOLEAN"],
    ["BUSINESS", "online_booking", "Онлайн цаг захиалга", null, "BOOLEAN"],
    ["ENTERPRISE", "online_booking", "Онлайн цаг захиалга", null, "BOOLEAN"],
  ] as const;
  for (const [plan, code, label, intValue, kind] of limits) {
    await db.planLimit.upsert({
      where: { plan_code: { plan, code } },
      update: { label, intValue, kind, boolValue: kind === "BOOLEAN" },
      create: { id: `seed-plan-limit-${plan.toLowerCase()}-${code}`, plan, code, label, intValue, kind, boolValue: kind === "BOOLEAN" },
    });
  }
  return priceIds;
}

export async function seedFixtureData(db: SeedDb) {
  console.log("CarService seed: realistic Mongolia fixture өгөгдөл эхэлж байна...");
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);
  const priceIds = await seedPlans(db);

  await db.platformSetting.upsert({
    where: { id: "default" },
    update: { facebookUrl: "https://facebook.com/carservice", youtubeUrl: "https://youtube.com/@carservice", appointmentFeeEnabled: true, appointmentFeeAmount: 1000 },
    create: { id: "default", facebookUrl: "https://facebook.com/carservice", youtubeUrl: "https://youtube.com/@carservice", appointmentFeeEnabled: true, appointmentFeeAmount: 1000 },
  });

  await db.superAdmin.upsert({
      where: { email: "superadmin@carservice.mn" },
    update: { firstName: "Супер", lastName: "Админ", passwordHash },
    create: { id: "seed-super-admin", email: "superadmin@carservice.mn", firstName: "Супер", lastName: "Админ", passwordHash },
  });

  // Category.systemServiceKeyId заавал тул фикстур ангилал бүрд хэрэгтэй —
  // прод дэх backfill migration-той адил "Ерөнхий" анхдагч түлхүүр.
  const generalServiceKey = await db.systemServiceKey.upsert({
    where: { name: "Ерөнхий" },
    update: {},
    create: { id: "seed-servicekey-general", name: "Ерөнхий", description: "Тодорхой систем ангилалд ороогүй үйлчилгээнд зориулсан ерөнхий түлхүүр.", createdById: "seed-super-admin" },
  });

  // categorySeed-тэй индексээрээ 1:1 тохирох тодорхой түлхүүрүүд (доор харах).
  const categoryServiceKeys: string[] = [];
  for (let keyIndex = 0; keyIndex < systemServiceKeySeed.length; keyIndex++) {
    const [name, description] = systemServiceKeySeed[keyIndex];
    const id = `seed-servicekey-${keyIndex + 1}`;
    categoryServiceKeys.push(id);
    await db.systemServiceKey.upsert({
      where: { name },
      update: { description, isActive: true },
      create: { id, name, description, createdById: "seed-super-admin" },
    });
  }

  const allBranches: Array<{ tenantId: string; id: string; name: string; city: string; district: string; khoroo: string; address: string; latitude: number; longitude: number }> = [];
  const tenantUsers = new Map<string, string[]>();
  const tenantCategories = new Map<string, string[]>();
  const tenantServices = new Map<string, string[]>();
  const tenantTemplates = new Map<string, string[]>();

  // Системийн (глобал) роль — migration-д үүссэн байх ч, хоосон DB-д seed
  // ажиллахад заавал байлгана. Эрхийг дарж бичихгүй (супер админы засвар).
  for (const r of SYSTEM_ROLE_DEFAULTS) {
    await db.role.upsert({
      where: { id: r.id },
      update: {},
      create: { id: r.id, key: r.key, name: r.name, description: r.description, permissions: [...r.permissions], sortOrder: r.sortOrder },
    });
  }

  for (let tenantIndex = 0; tenantIndex < tenants.length; tenantIndex++) {
    const tenant = tenants[tenantIndex];
    await db.tenant.upsert({
      where: { id: tenant.id },
      update: { slug: tenant.slug, name: tenant.name, registerNumber: tenant.registerNumber, email: tenant.email, phone1: tenant.phone1, phone2: tenant.phone2, plan: tenant.plan, acceptsOnlineBooking: tenant.acceptsOnlineBooking, suspended: false },
      create: tenant,
    });

    const userIds: string[] = [];
    const staff = [
      ["Бат", "Эрдэнэ", `owner${tenantIndex + 1}@carservice.mn`, `8800000${tenantIndex + 1}`, true, null],
      ["Саруул", "Мөнх", `service${tenantIndex + 1}@carservice.mn`, `8800010${tenantIndex + 1}`, false, "sysrole_engineer"],
      ["Гарьд", "Төгс", `tech${tenantIndex + 1}@carservice.mn`, `8800020${tenantIndex + 1}`, false, "sysrole_mechanic"],
    ] as const;
    for (let staffIndex = 0; staffIndex < staff.length; staffIndex++) {
      const [firstName, lastName, email, phone, isOwner, assignedRoleId] = staff[staffIndex];
      const id = `seed-user-${tenantIndex + 1}-${staffIndex + 1}`;
      userIds.push(id);
      await db.user.upsert({
        where: { email },
        update: { firstName, lastName, phone, tenantId: tenant.id, isOwner, roleId: assignedRoleId, passwordHash, verified: true, isActive: true },
        create: { id, email, firstName, lastName, phone, tenantId: tenant.id, isOwner, roleId: assignedRoleId, passwordHash, verified: true, isActive: true },
      });
    }
    tenantUsers.set(tenant.id, userIds);

    const branches: string[] = [];
    for (let branchIndex = 0; branchIndex < branchSeed[tenantIndex].length; branchIndex++) {
      const [name, district, khoroo, address, latitude, longitude] = branchSeed[tenantIndex][branchIndex];
      const id = `seed-branch-${tenantIndex + 1}-${branchIndex + 1}`;
      branches.push(id);
      allBranches.push({ tenantId: tenant.id, id, name, city: tenantIndex < 2 ? "Улаанбаатар" : tenantIndex === 2 ? "Дархан-Уул" : "Орхон", district, khoroo, address, latitude, longitude });
      await db.branch.upsert({
        where: { id },
        update: { name, phone: tenant.phone1, isPrimary: branchIndex === 0, isActive: true, city: tenantIndex < 2 ? "Улаанбаатар" : tenantIndex === 2 ? "Дархан-Уул" : "Орхон", district, khoroo, address, latitude, longitude, openTime: "09:00", closeTime: branchIndex === 1 ? "19:00" : "18:00", slotMinutes: branchIndex === 1 ? 60 : 30, slotCapacity: branchIndex === 0 ? 2 : 1, tenantId: tenant.id },
        create: { id, name, phone: tenant.phone1, isPrimary: branchIndex === 0, city: tenantIndex < 2 ? "Улаанбаатар" : tenantIndex === 2 ? "Дархан-Уул" : "Орхон", district, khoroo, address, latitude, longitude, openTime: "09:00", closeTime: branchIndex === 1 ? "19:00" : "18:00", slotMinutes: branchIndex === 1 ? 60 : 30, slotCapacity: branchIndex === 0 ? 2 : 1, tenantId: tenant.id },
      });
      const weekdays = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
      for (const weekday of weekdays) {
        const isSunday = weekday === "SUN";
        await db.branchSchedule.upsert({
          where: { branchId_weekday: { branchId: id, weekday } },
          update: { isOpen: !isSunday || branchIndex === 0, openTime: isSunday ? "10:00" : "09:00", closeTime: isSunday ? "16:00" : branchIndex === 1 ? "19:00" : "18:00" },
          create: { id: `seed-schedule-${id}-${weekday.toLowerCase()}`, branchId: id, weekday, isOpen: !isSunday || branchIndex === 0, openTime: isSunday ? "10:00" : "09:00", closeTime: isSunday ? "16:00" : branchIndex === 1 ? "19:00" : "18:00" },
        });
      }
      if (branchIndex === 0) {
        await db.branchScheduleException.upsert({
          where: { id: `seed-exception-${id}-naadam` },
          update: { date: new Date("2026-07-11T00:00:00+08:00"), isOpen: false, openTime: null, closeTime: null, label: "Наадам" },
          create: { id: `seed-exception-${id}-naadam`, branchId: id, date: new Date("2026-07-11T00:00:00+08:00"), isOpen: false, label: "Наадам" },
        });
        await db.branchScheduleException.upsert({
          where: { id: `seed-exception-${id}-newyear` },
          update: { date: new Date("2027-01-02T00:00:00+08:00"), isOpen: true, openTime: "11:00", closeTime: "15:00", label: "Шинэ жилийн богино өдөр" },
          create: { id: `seed-exception-${id}-newyear`, branchId: id, date: new Date("2027-01-02T00:00:00+08:00"), isOpen: true, openTime: "11:00", closeTime: "15:00", label: "Шинэ жилийн богино өдөр" },
        });
        const seasonId = `seed-season-${id}-winter`;
        await db.branchScheduleSeason.upsert({
          where: { id: seasonId },
          update: { name: "Өвлийн цагийн хуваарь", startsOn: new Date("2026-10-01T00:00:00+08:00"), endsOn: new Date("2027-03-01T00:00:00+08:00"), isActive: true },
          create: { id: seasonId, branchId: id, name: "Өвлийн цагийн хуваарь", startsOn: new Date("2026-10-01T00:00:00+08:00"), endsOn: new Date("2027-03-01T00:00:00+08:00"), isActive: true },
        });
        for (const weekday of weekdays) {
          await db.branchScheduleSeasonDay.upsert({
            where: { seasonId_weekday: { seasonId, weekday } },
            update: { isOpen: weekday !== "SUN", openTime: weekday === "SAT" ? "10:00" : "09:30", closeTime: weekday === "SAT" ? "17:00" : "17:30" },
            create: { seasonId, weekday, isOpen: weekday !== "SUN", openTime: weekday === "SAT" ? "10:00" : "09:30", closeTime: weekday === "SAT" ? "17:00" : "17:30" },
          });
        }
      }
    }

    const units = new Map<string, string>();
    for (const [name, code] of [["ширхэг", "ш"], ["литр", "л"], ["цаг", "ц"]] as const) {
      const id = `seed-unit-${tenantIndex + 1}-${code}`;
      units.set(name, id);
      await db.unit.upsert({ where: { tenantId_name: { tenantId: tenant.id, name } }, update: { code, isActive: true }, create: { id, tenantId: tenant.id, name, code } });
    }

    const categoryProfile = tenantCategoryProfiles[tenantIndex] ?? tenantCategoryProfiles[0];
    const categoryIds: string[] = [];
    for (let categoryIndex = 0; categoryIndex < categorySeed.length; categoryIndex++) {
      const [name, description, baseDurationMinutes] = categorySeed[categoryIndex];
      const id = `seed-category-${tenantIndex + 1}-${categoryIndex + 1}`;
      categoryIds.push(id);
      const systemServiceKeyId = categoryServiceKeys[categoryIndex] ?? generalServiceKey.id;
      const isActive = !categoryProfile.inactive.has(categoryIndex);
      const durationMinutes = Math.round((baseDurationMinutes * categoryProfile.durationFactor) / 5) * 5;
      const concurrentCapacity = categoryProfile.capacityBoost.has(categoryIndex) ? 2 : 1;
      await db.category.upsert({
        where: { tenantId_name: { tenantId: tenant.id, name } },
        update: { description, durationMinutes, concurrentCapacity, isActive, systemServiceKeyId, branches: { connect: branches.map((branchId) => ({ id: branchId })) } },
        create: { id, tenantId: tenant.id, name, description, durationMinutes, concurrentCapacity, isActive, systemServiceKeyId, branches: { connect: branches.map((branchId) => ({ id: branchId })) } },
      });
    }
    tenantCategories.set(tenant.id, categoryIds);

    const serviceIds: string[] = [];
    for (let serviceIndex = 0; serviceIndex < serviceSeed.length; serviceIndex++) {
      const [type, name, code, price, categoryName, durationMinutes] = serviceSeed[serviceIndex];
      const id = `seed-service-${tenantIndex + 1}-${serviceIndex + 1}`;
      serviceIds.push(id);
      const categoryIndex = categorySeed.findIndex(([candidate]) => candidate === categoryName);
      const categoryId = categoryIds[categoryIndex];
      const unitId = type === "GOODS" ? units.get("ширхэг") : units.get("цаг");
      await db.service.upsert({
        where: { tenantId_type_code: { tenantId: tenant.id, type, code } },
        update: { name, price, costPrice: type === "GOODS" ? Math.round(price * 0.7) : null, stock: type === "GOODS" ? 18 + serviceIndex : null, description: `${tenant.name} — ${name}`, isActive: serviceIndex !== 8, unitId, durationValue: durationMinutes, durationUnitId: durationMinutes == null ? null : units.get("цаг"), categoryId },
        create: { id, tenantId: tenant.id, type, name, code, price, costPrice: type === "GOODS" ? Math.round(price * 0.7) : null, stock: type === "GOODS" ? 18 + serviceIndex : null, description: `${tenant.name} — ${name}`, isActive: serviceIndex !== 8, unitId, durationValue: durationMinutes, durationUnitId: durationMinutes == null ? null : units.get("цаг"), categoryId },
      });
    }
    tenantServices.set(tenant.id, serviceIds);

    const templateIds: string[] = [];
    for (const [templateIndex, [name, type, categoryIndex]] of ([
      ["Ерөнхий үзлэг", "INTAKE", 0],
      ["Үйлчилгээний дараах шалгалт", "POST_SERVICE", 1],
      ["Улирлын бэлэн байдлын шалгалт", "ROUTINE", 4],
    ] as const).entries()) {
      const id = `seed-template-${tenantIndex + 1}-${templateIndex + 1}`;
      templateIds.push(id);
      await db.diagnosticTemplate.upsert({
        where: { id },
        update: { name, type, schema: diagnosticSchema, version: 1, isActive: true, price: type === "INTAKE" ? 50000 : 0, durationMin: 60, categoryId: categoryIds[categoryIndex], createdById: userIds[0], tenantId: tenant.id },
        create: { id, name, type, schema: diagnosticSchema, version: 1, isActive: true, price: type === "INTAKE" ? 50000 : 0, durationMin: 60, categoryId: categoryIds[categoryIndex], createdById: userIds[0], tenantId: tenant.id },
      });
    }
    tenantTemplates.set(tenant.id, templateIds);
    await db.tenantQPaySettings.upsert({ where: { tenantId: tenant.id }, update: { username: `seed_qpay_${tenantIndex + 1}`, password: "seed-only", invoiceCode: `SEED${tenantIndex + 1}`, callbackUrl: "https://example.test/qpay/callback", enabled: true }, create: { id: `seed-tenant-qpay-${tenantIndex + 1}`, tenantId: tenant.id, username: `seed_qpay_${tenantIndex + 1}`, password: "seed-only", invoiceCode: `SEED${tenantIndex + 1}`, callbackUrl: "https://example.test/qpay/callback", enabled: true } });
    await db.subscription.upsert({ where: { id: `seed-subscription-${tenantIndex + 1}` }, update: { plan: tenant.plan, status: tenantIndex === 3 ? "TRIAL" : "ACTIVE", startsAt: new Date("2026-08-01T00:00:00+08:00"), endsAt: tenantIndex === 3 ? new Date("2026-09-15T00:00:00+08:00") : null, amount: tenantIndex === 3 ? null : tenant.plan === "ENTERPRISE" ? 399000 : 149000, notes: "Seed subscription" }, create: { id: `seed-subscription-${tenantIndex + 1}`, tenantId: tenant.id, plan: tenant.plan, status: tenantIndex === 3 ? "TRIAL" : "ACTIVE", startsAt: new Date("2026-08-01T00:00:00+08:00"), endsAt: tenantIndex === 3 ? new Date("2026-09-15T00:00:00+08:00") : null, amount: tenantIndex === 3 ? null : tenant.plan === "ENTERPRISE" ? 399000 : 149000, notes: "Seed subscription" } });
    const subscriptionPriceId = priceIds.get(`${tenant.plan}:MONTH`);
    await db.subscriptionPayment.upsert({ where: { id: `seed-sub-payment-${tenantIndex + 1}` }, update: { tenantId: tenant.id, plan: tenant.plan, period: "MONTH", amount: tenantIndex === 3 ? 0 : tenant.plan === "ENTERPRISE" ? 399000 : 149000, planPriceId: subscriptionPriceId, method: "QPAY", status: tenantIndex === 3 ? "PENDING" : "PAID", qpayInvoiceId: `SEED-SUB-${tenantIndex + 1}`, paidAt: tenantIndex === 3 ? null : new Date("2026-08-01T02:00:00+08:00"), createdSubscriptionId: `seed-subscription-${tenantIndex + 1}` }, create: { id: `seed-sub-payment-${tenantIndex + 1}`, tenantId: tenant.id, plan: tenant.plan, period: "MONTH", amount: tenantIndex === 3 ? 0 : tenant.plan === "ENTERPRISE" ? 399000 : 149000, planPriceId: subscriptionPriceId, method: "QPAY", status: tenantIndex === 3 ? "PENDING" : "PAID", qpayInvoiceId: `SEED-SUB-${tenantIndex + 1}`, paidAt: tenantIndex === 3 ? null : new Date("2026-08-01T02:00:00+08:00"), createdSubscriptionId: `seed-subscription-${tenantIndex + 1}` } });
  }

  const accounts: Array<{ id: string; name: string; phone: string; vehicleIds: string[] }> = [];
  for (let i = 0; i < accountNames.length; i++) {
    const [firstName, lastName, phone] = accountNames[i];
    const id = `seed-account-${i + 1}`;
    accounts.push({ id, name: `${firstName} ${lastName}`, phone, vehicleIds: [] });
    await db.account.upsert({ where: { phone }, update: { name: `${firstName} ${lastName}`, email: `customer${i + 1}@example.test`, isActive: true, lastLoginAt: daysFrom(SEED_DATE, -i, 18) }, create: { id, phone, name: `${firstName} ${lastName}`, email: `customer${i + 1}@example.test`, isActive: true, lastLoginAt: daysFrom(SEED_DATE, -i, 18) } });
  }

  const vehicles: Array<{ id: string; plate: string }> = [];
  for (let i = 0; i < vehicleSeed.length; i++) {
    const [plate, make, model, year, mileage, fuelType, wheelPosition, colorName, capacity, purpose] = vehicleSeed[i];
    const id = `seed-vehicle-${i + 1}`;
    vehicles.push({ id, plate });
    await db.vehicle.upsert({ where: { id }, update: { plate, vin: `SEEDHURVIN${String(i + 1).padStart(5, "0")}`, make, model, year, mileage, fuelType, wheelPosition, colorName, capacity, purpose }, create: { id, plate, vin: `SEEDHURVIN${String(i + 1).padStart(5, "0")}`, make, model, year, mileage, fuelType, wheelPosition, colorName, capacity, purpose } });
    const account = accounts[i % accounts.length];
    account.vehicleIds.push(id);
    await db.accountVehicle.upsert({ where: { accountId_vehicleId: { accountId: account.id, vehicleId: id } }, update: {}, create: { id: `seed-account-vehicle-${i + 1}`, accountId: account.id, vehicleId: id } });
  }

  const customersByTenant = new Map<string, string[]>();
  const tenantVehiclesByTenant = new Map<string, string[]>();
  for (let tenantIndex = 0; tenantIndex < tenants.length; tenantIndex++) {
    const tenant = tenants[tenantIndex];
    const customerIds: string[] = [];
    const tenantVehicleIds: string[] = [];
    for (let i = 0; i < accounts.length; i++) {
      if ((i + tenantIndex) % 3 === 2) continue;
      const account = accounts[i];
      const customerId = `seed-customer-${tenantIndex + 1}-${i + 1}`;
      customerIds.push(customerId);
      await db.customer.upsert({ where: { id: customerId }, update: { fullName: account.name, phone: account.phone, email: `customer${i + 1}@example.test`, note: i % 4 === 0 ? "VIP үйлчлүүлэгч — тогтмол үйлчилгээ" : null, tenantId: tenant.id, accountId: account.id }, create: { id: customerId, fullName: account.name, phone: account.phone, email: `customer${i + 1}@example.test`, note: i % 4 === 0 ? "VIP үйлчлүүлэгч — тогтмол үйлчилгээ" : null, tenantId: tenant.id, accountId: account.id } });
      for (const vehicleId of account.vehicleIds) {
        const tenantVehicleId = `seed-tenant-vehicle-${tenantIndex + 1}-${vehicleId.replace("seed-vehicle-", "")}`;
        tenantVehicleIds.push(tenantVehicleId);
        await db.tenantVehicle.upsert({ where: { tenantId_vehicleId: { tenantId: tenant.id, vehicleId } }, update: { customerId, isActive: true, isPostpaid: (i + tenantIndex) % 7 === 0, notes: i % 5 === 0 ? "Улирлын үйлчилгээний сануулгатай" : null }, create: { id: tenantVehicleId, tenantId: tenant.id, vehicleId, customerId, isActive: true, isPostpaid: (i + tenantIndex) % 7 === 0, notes: i % 5 === 0 ? "Улирлын үйлчилгээний сануулгатай" : null } });
      }
    }
    for (let walkIn = 0; walkIn < 3; walkIn++) {
      const id = `seed-walkin-customer-${tenantIndex + 1}-${walkIn + 1}`;
      customerIds.push(id);
      await db.customer.upsert({ where: { id }, update: { fullName: ["Болдбаатар", "Түмэн", "Одгэрэл"][walkIn], phone: `911${tenantIndex + 1}${walkIn + 1}000`, email: null, note: "Утсаар бүртгэсэн үйлчлүүлэгч", tenantId: tenant.id, accountId: null }, create: { id, fullName: ["Болдбаатар", "Түмэн", "Одгэрэл"][walkIn], phone: `911${tenantIndex + 1}${walkIn + 1}000`, note: "Утсаар бүртгэсэн үйлчлүүлэгч", tenantId: tenant.id } });
    }
    customersByTenant.set(tenant.id, customerIds);
    tenantVehiclesByTenant.set(tenant.id, tenantVehicleIds);
  }

  const orderIds: string[] = [];
  const orderIdsByTenant = new Map<string, string[]>();
  const appointmentIds: string[] = [];
  for (let tenantIndex = 0; tenantIndex < tenants.length; tenantIndex++) {
    const tenant = tenants[tenantIndex];
    const branchIds = allBranches.filter((branch) => branch.tenantId === tenant.id).map((branch) => branch.id);
    const customerIds = customersByTenant.get(tenant.id) ?? [];
    const users = tenantUsers.get(tenant.id) ?? [];
    const categoryIds = tenantCategories.get(tenant.id) ?? [];
    const serviceIds = tenantServices.get(tenant.id) ?? [];
    const templateIds = tenantTemplates.get(tenant.id) ?? [];
    const orderForAppointment = new Map<number, string>();
    const tenantOrderIds: string[] = [];

    const orderCount = tenantIndex === 0 ? 96 : 18;
    const denseBranchId =
      tenantIndex === 0
        ? allBranches.find((branch) => branch.name === "3-р хороолол салбар")?.id ?? branchIds[0]
        : null;
    for (let i = 0; i < orderCount; i++) {
      const orderId = `seed-order-${tenantIndex + 1}-${i + 1}`;
      orderIds.push(orderId);
      tenantOrderIds.push(orderId);
      const customerId = customerIds[i % customerIds.length];
      const account = accounts[(i + tenantIndex) % accounts.length];
      const vehicleId = account.vehicleIds[0] ?? vehicles[(i + tenantIndex) % vehicles.length].id;
      const branchId = denseBranchId && i % 5 !== 0 ? denseBranchId : branchIds[i % branchIds.length];
      const status = orderStatuses[i % orderStatuses.length];
      const paymentStatus = status === "COMPLETED" ? "PAID" : status === "IN_PROGRESS" ? "PARTIAL" : "UNPAID";
      const scheduleDayOffset = tenantIndex === 0 ? -3 + (i % 7) : -12 + i;
      const scheduledAt = daysFrom(SEED_DATE, scheduleDayOffset, 9 + (i % 8), i % 2 === 0 ? 0 : 30);
      const isDiagnostic = i % 3 === 0;
      const totalAmount = isDiagnostic ? 265000 : i % 2 === 0 ? 305000 : 340000;
      await db.serviceOrder.upsert({ where: { id: orderId }, update: { number: `D${tenantIndex + 1}-${String(1001 + i).padStart(4, "0")}`, status, paymentStatus, isPostpaid: i % 7 === 0, scheduledAt, startedAt: status === "SCHEDULED" || status === "CANCELLED" ? null : new Date(scheduledAt.getTime() + 30 * 60 * 1000), completedAt: status === "COMPLETED" ? new Date(scheduledAt.getTime() + 150 * 60 * 1000) : null, estimatedDurationMinutes: isDiagnostic ? 120 : 90, expectedFinishAt: status === "IN_PROGRESS" ? new Date(SEED_DATE.getTime() + 90 * 60 * 1000) : null, occupiesCapacity: status === "IN_PROGRESS" ? true : status === "SCHEDULED" ? null : false, notes: i % 4 === 0 ? "Үйлчлүүлэгчийн хүсэлтээр эхлээд оношилгоо хийсэн." : null, totalAmount, paidAmount: paymentStatus === "PAID" ? totalAmount : paymentStatus === "PARTIAL" ? Math.round(totalAmount / 2) : 0, tenantId: tenant.id, branchId, customerId, vehicleId, assignedToId: users[1] }, create: { id: orderId, number: `D${tenantIndex + 1}-${String(1001 + i).padStart(4, "0")}`, status, paymentStatus, isPostpaid: i % 7 === 0, scheduledAt, startedAt: status === "SCHEDULED" || status === "CANCELLED" ? null : new Date(scheduledAt.getTime() + 30 * 60 * 1000), completedAt: status === "COMPLETED" ? new Date(scheduledAt.getTime() + 150 * 60 * 1000) : null, estimatedDurationMinutes: isDiagnostic ? 120 : 90, expectedFinishAt: status === "IN_PROGRESS" ? new Date(SEED_DATE.getTime() + 90 * 60 * 1000) : null, occupiesCapacity: status === "IN_PROGRESS" ? true : status === "SCHEDULED" ? null : false, notes: i % 4 === 0 ? "Үйлчлүүлэгчийн хүсэлтээр эхлээд оношилгоо хийсэн." : null, totalAmount, paidAmount: paymentStatus === "PAID" ? totalAmount : paymentStatus === "PARTIAL" ? Math.round(totalAmount / 2) : 0, tenantId: tenant.id, branchId, customerId, vehicleId, assignedToId: users[1] } });
      const laborId = `seed-item-${tenantIndex + 1}-${i + 1}-labor`;
      await db.serviceItem.upsert({ where: { id: laborId }, update: { kind: "LABOR", description: isDiagnostic ? "Ерөнхий оношилгоо хийх" : "Төлөвлөгөөт засвар үйлчилгээ", quantity: 1, unitPrice: isDiagnostic ? 80000 : 120000, total: isDiagnostic ? 80000 : 120000, status: status === "COMPLETED" ? "COMPLETED" : status === "CANCELLED" ? "CANCELLED" : "PENDING", orderId, serviceId: isDiagnostic ? serviceIds[3] : serviceIds[0], diagnosticTemplateId: null, cancelledAt: status === "CANCELLED" ? new Date(scheduledAt.getTime() + 60 * 60 * 1000) : null, cancelledById: status === "CANCELLED" ? users[1] : null }, create: { id: laborId, kind: "LABOR", description: isDiagnostic ? "Ерөнхий оношилгоо хийх" : "Төлөвлөгөөт засвар үйлчилгээ", quantity: 1, unitPrice: isDiagnostic ? 80000 : 120000, total: isDiagnostic ? 80000 : 120000, status: status === "COMPLETED" ? "COMPLETED" : status === "CANCELLED" ? "CANCELLED" : "PENDING", orderId, serviceId: isDiagnostic ? serviceIds[3] : serviceIds[0], cancelledAt: status === "CANCELLED" ? new Date(scheduledAt.getTime() + 60 * 60 * 1000) : null, cancelledById: status === "CANCELLED" ? users[1] : null } });
      const partId = `seed-item-${tenantIndex + 1}-${i + 1}-part`;
      await db.serviceItem.upsert({ where: { id: partId }, update: { kind: "PART", description: i % 2 === 0 ? "0W-20 моторын тос" : "Тоормосны наклад", quantity: 1, unitPrice: i % 2 === 0 ? 185000 : 220000, total: i % 2 === 0 ? 185000 : 220000, status: status === "COMPLETED" ? "COMPLETED" : status === "CANCELLED" ? "CANCELLED" : "PENDING", orderId, serviceId: i % 2 === 0 ? serviceIds[6] : serviceIds[7] }, create: { id: partId, kind: "PART", description: i % 2 === 0 ? "0W-20 моторын тос" : "Тоормосны наклад", quantity: 1, unitPrice: i % 2 === 0 ? 185000 : 220000, total: i % 2 === 0 ? 185000 : 220000, status: status === "COMPLETED" ? "COMPLETED" : status === "CANCELLED" ? "CANCELLED" : "PENDING", orderId, serviceId: i % 2 === 0 ? serviceIds[6] : serviceIds[7] } });
      if (isDiagnostic) {
        const reportId = `seed-report-${tenantIndex + 1}-${i + 1}`;
        await db.diagnosticReport.upsert({ where: { id: reportId }, update: { templateVersion: 1, data: reportData(i), maxSeverity: i % 5 === 0 ? "BAD" : i % 2 === 0 ? "WARN" : "GOOD", signatureUrl: "https://placehold.co/640x220/png?text=Customer+Signature", mileageAtReport: 81000 + i * 700, notes: i % 2 === 0 ? "Үйлчилгээний зөвлөмжийг үйлчлүүлэгчид тайлбарласан." : null, tenantId: tenant.id, templateId: templateIds[i % templateIds.length], orderId, customerId, vehicleId, branchId, filledById: users[2] }, create: { id: reportId, templateVersion: 1, data: reportData(i), maxSeverity: i % 5 === 0 ? "BAD" : i % 2 === 0 ? "WARN" : "GOOD", signatureUrl: "https://placehold.co/640x220/png?text=Customer+Signature", mileageAtReport: 81000 + i * 700, notes: i % 2 === 0 ? "Үйлчилгээний зөвлөмжийг үйлчлүүлэгчид тайлбарласан." : null, tenantId: tenant.id, templateId: templateIds[i % templateIds.length], orderId, customerId, vehicleId, branchId, filledById: users[2] } });
        const diagnosticItemId = `seed-item-${tenantIndex + 1}-${i + 1}-diagnostic`;
        await db.serviceItem.upsert({ where: { id: diagnosticItemId }, update: { kind: "DIAGNOSTIC", description: "Оношилгооны хуудас", quantity: 1, unitPrice: 80000, total: 80000, status: status === "COMPLETED" ? "COMPLETED" : "PENDING", orderId, serviceId: serviceIds[10], diagnosticTemplateId: templateIds[i % templateIds.length], diagnosticReportId: reportId }, create: { id: diagnosticItemId, kind: "DIAGNOSTIC", description: "Оношилгооны хуудас", quantity: 1, unitPrice: 80000, total: 80000, status: status === "COMPLETED" ? "COMPLETED" : "PENDING", orderId, serviceId: serviceIds[10], diagnosticTemplateId: templateIds[i % templateIds.length], diagnosticReportId: reportId } });
      }
      if (paymentStatus !== "UNPAID") await db.orderPayment.upsert({ where: { id: `seed-order-payment-${tenantIndex + 1}-${i + 1}` }, update: { tenantId: tenant.id, orderId, amount: paymentStatus === "PAID" ? totalAmount : Math.round(totalAmount / 2), method: i % 3 === 0 ? "QPAY" : "CARD", status: "PAID", qpayInvoiceId: `SEED-ORDER-${tenantIndex + 1}-${i + 1}`, qpayPaymentId: `SEED-PAY-${tenantIndex + 1}-${i + 1}`, paidAt: new Date(scheduledAt.getTime() + 180 * 60 * 1000) }, create: { id: `seed-order-payment-${tenantIndex + 1}-${i + 1}`, tenantId: tenant.id, orderId, amount: paymentStatus === "PAID" ? totalAmount : Math.round(totalAmount / 2), method: i % 3 === 0 ? "QPAY" : "CARD", status: "PAID", qpayInvoiceId: `SEED-ORDER-${tenantIndex + 1}-${i + 1}`, qpayPaymentId: `SEED-PAY-${tenantIndex + 1}-${i + 1}`, paidAt: new Date(scheduledAt.getTime() + 180 * 60 * 1000) } });
      if (i % 3 === 0) orderForAppointment.set(i, orderId);
    }
    orderIdsByTenant.set(tenant.id, tenantOrderIds);

    const appointmentCount = tenantIndex === 0 ? 120 : 24;
    for (let i = 0; i < appointmentCount; i++) {
      const appointmentId = `seed-appointment-${tenantIndex + 1}-${i + 1}`;
      appointmentIds.push(appointmentId);
      const customerId = customerIds[(i + 2) % customerIds.length];
      const accountIndex = (i + tenantIndex + 2) % accounts.length;
      const account = accounts[accountIndex];
      const vehicleId = account.vehicleIds[0] ?? vehicles[(i + 3) % vehicles.length].id;
      const accountVehicleId = `seed-account-vehicle-${(accountIndex % vehicleSeed.length) + 1}`;
      const branchId = denseBranchId && i % 4 !== 0 ? denseBranchId : branchIds[i % branchIds.length];
      const status = appointmentStatuses[i % appointmentStatuses.length];
      const appointmentDayOffset = tenantIndex === 0 ? -3 + (i % 9) : i < 6 ? i + 1 : -20 + i;
      const requestedAt = daysFrom(SEED_DATE, appointmentDayOffset, 9 + (i % 8), i % 2 === 0 ? 0 : 30);
      const confirmedOrderIndex = [1, 5, 7, 11, 13, 17].indexOf(i);
      const linkedOrderId =
        status === "CONFIRMED" && confirmedOrderIndex >= 0
          ? orderForAppointment.get(confirmedOrderIndex * 3) ?? null
          : null;
      const responded = status !== "PENDING";
      await db.appointment.upsert({ where: { id: appointmentId }, update: { status, requestedAt, estimatedDurationMinutes: categorySeed[i % categorySeed.length][2], arrivedAt: status === "NO_SHOW" ? null : status === "CONFIRMED" && i % 4 === 1 ? new Date(requestedAt.getTime() + 5 * 60 * 1000) : null, note: i % 4 === 0 ? "Урд дугуй болон тоормос шалгуулна." : null, tenantId: tenant.id, branchId, accountId: account.id, customerId, accountVehicleId, categoryId: categoryIds[i % categoryIds.length], vehicleId: linkedOrderId ? vehicleId : null, serviceOrderId: linkedOrderId, respondedAt: responded ? new Date(requestedAt.getTime() - 12 * 60 * 60 * 1000) : null, respondedById: responded ? users[0] : null, feeAmount: i % 4 === 0 ? 1000 : null, feeCurrency: i % 4 === 0 ? "MNT" : null }, create: { id: appointmentId, status, requestedAt, estimatedDurationMinutes: categorySeed[i % categorySeed.length][2], arrivedAt: status === "CONFIRMED" && i % 4 === 1 ? new Date(requestedAt.getTime() + 5 * 60 * 1000) : null, note: i % 4 === 0 ? "Урд дугуй болон тоормос шалгуулна." : null, tenantId: tenant.id, branchId, accountId: account.id, customerId, accountVehicleId, categoryId: categoryIds[i % categoryIds.length], vehicleId: linkedOrderId ? vehicleId : null, serviceOrderId: linkedOrderId, respondedAt: responded ? new Date(requestedAt.getTime() - 12 * 60 * 60 * 1000) : null, respondedById: responded ? users[0] : null, feeAmount: i % 4 === 0 ? 1000 : null, feeCurrency: i % 4 === 0 ? "MNT" : null } });
      await db.appointmentCategory.upsert({ where: { appointmentId_categoryId: { appointmentId, categoryId: categoryIds[i % categoryIds.length] } }, update: {}, create: { appointmentId, categoryId: categoryIds[i % categoryIds.length] } });
      if (status === "CONFIRMED" && i % 2 === 1) await db.appointmentPayment.upsert({ where: { appointmentId }, update: { tenantId: tenant.id, accountId: account.id, amount: 1000, currency: "MNT", status: "PAID", qpayInvoiceId: `SEED-APPT-${tenantIndex + 1}-${i + 1}`, qpayPaymentId: `SEED-APPT-PAY-${tenantIndex + 1}-${i + 1}`, paidAt: new Date(requestedAt.getTime() - 60 * 60 * 1000), paymentType: i % 8 === 0 ? "CARD" : "P2P" }, create: { id: `seed-appointment-payment-${tenantIndex + 1}-${i + 1}`, appointmentId, tenantId: tenant.id, accountId: account.id, amount: 1000, currency: "MNT", status: "PAID", qpayInvoiceId: `SEED-APPT-${tenantIndex + 1}-${i + 1}`, qpayPaymentId: `SEED-APPT-PAY-${tenantIndex + 1}-${i + 1}`, paidAt: new Date(requestedAt.getTime() - 60 * 60 * 1000), paymentType: i % 8 === 0 ? "CARD" : "P2P" } });
    }
  }

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    await db.device.upsert({ where: { deviceId: `seed-device-account-${i + 1}` }, update: { platform: i % 2 === 0 ? "ANDROID" : "IOS", accountId: account.id, userId: null, name: i % 2 === 0 ? "Android" : "iPhone", model: i % 2 === 0 ? "Pixel 8" : "iPhone 15", os: i % 2 === 0 ? "Android 15" : "iOS 18", firebaseToken: `seed-fcm-account-${i + 1}`, lastSeenAt: daysFrom(SEED_DATE, -i, 19) }, create: { id: `seed-device-account-${i + 1}`, deviceId: `seed-device-account-${i + 1}`, platform: i % 2 === 0 ? "ANDROID" : "IOS", accountId: account.id, name: i % 2 === 0 ? "Android" : "iPhone", model: i % 2 === 0 ? "Pixel 8" : "iPhone 15", os: i % 2 === 0 ? "Android 15" : "iOS 18", firebaseToken: `seed-fcm-account-${i + 1}` } });
    await db.notification.upsert({ where: { id: `seed-notification-account-${i + 1}` }, update: { accountId: account.id, userId: null, tenantId: null, type: i % 2 === 0 ? "appointment_confirmed" : "service_completed", title: i % 2 === 0 ? "Цаг захиалга баталгаажлаа" : "Үйлчилгээ дууслаа", body: i % 2 === 0 ? "Таны цагийн хүсэлтийг баталгаажууллаа." : "Таны автомашины үйлчилгээ дууссан байна.", data: { appointmentId: appointmentIds[i % appointmentIds.length], orderId: orderIds[i % orderIds.length] }, readAt: i % 3 === 0 ? null : daysFrom(SEED_DATE, -i, 20) }, create: { id: `seed-notification-account-${i + 1}`, accountId: account.id, type: i % 2 === 0 ? "appointment_confirmed" : "service_completed", title: i % 2 === 0 ? "Цаг захиалга баталгаажлаа" : "Үйлчилгээ дууслаа", body: i % 2 === 0 ? "Таны цагийн хүсэлтийг баталгаажууллаа." : "Таны автомашины үйлчилгээ дууссан байна.", data: { appointmentId: appointmentIds[i % appointmentIds.length], orderId: orderIds[i % orderIds.length] }, readAt: i % 3 === 0 ? null : daysFrom(SEED_DATE, -i, 20), dedupeKey: `seed-notification-account-${i + 1}` } });
    if (i < tenants.length * 2) {
      const tenant = tenants[i % tenants.length];
      const userId = tenantUsers.get(tenant.id)?.[i % 3];
      if (userId) await db.notification.upsert({ where: { id: `seed-notification-user-${i + 1}` }, update: { tenantId: tenant.id, userId, accountId: null, type: "appointment_created", title: "Шинэ цаг захиалга", body: "Шинэ онлайн цагийн хүсэлт ирлээ.", data: { appointmentId: appointmentIds[(i + 4) % appointmentIds.length] }, readAt: i % 2 === 0 ? null : daysFrom(SEED_DATE, -2, 17), dedupeKey: `seed-notification-user-${i + 1}` }, create: { id: `seed-notification-user-${i + 1}`, tenantId: tenant.id, userId, type: "appointment_created", title: "Шинэ цаг захиалга", body: "Шинэ онлайн цагийн хүсэлт ирлээ.", data: { appointmentId: appointmentIds[(i + 4) % appointmentIds.length] }, dedupeKey: `seed-notification-user-${i + 1}` } });
    }
  }

  for (let i = 0; i < tenants.length; i++) {
    const tenant = tenants[i];
    const userId = tenantUsers.get(tenant.id)?.[0];
    const branchId = allBranches.find((branch) => branch.tenantId === tenant.id)?.id;
    const tenantOrderIds = orderIdsByTenant.get(tenant.id) ?? [];
    if (!userId || !branchId) continue;
    await db.device.upsert({ where: { deviceId: `seed-device-user-${i + 1}` }, update: { platform: "WEB", userId, accountId: null, name: "Chrome", model: "Desktop", os: "Windows 11", firebaseToken: `seed-fcm-user-${i + 1}` }, create: { id: `seed-device-user-${i + 1}`, deviceId: `seed-device-user-${i + 1}`, platform: "WEB", userId, name: "Chrome", model: "Desktop", os: "Windows 11", firebaseToken: `seed-fcm-user-${i + 1}` } });
    await db.userSession.upsert({ where: { id: `seed-session-${i + 1}` }, update: { userId, userAgent: "Chrome on Windows", ip: `192.0.2.${10 + i}`, createdAt: daysFrom(SEED_DATE, -2, 9), lastSeenAt: daysFrom(SEED_DATE, 0, 8), expiresAt: daysFrom(SEED_DATE, 10, 8) }, create: { id: `seed-session-${i + 1}`, userId, userAgent: "Chrome on Windows", ip: `192.0.2.${10 + i}`, expiresAt: daysFrom(SEED_DATE, 10, 8) } });
    await db.refreshToken.upsert({ where: { id: `seed-refresh-token-${i + 1}` }, update: { tokenHash: hash(`seed-refresh-token-${i + 1}`), userId, expiresAt: daysFrom(SEED_DATE, 30, 8), revokedAt: null, userAgent: "Chrome on Windows", ip: `192.0.2.${10 + i}` }, create: { id: `seed-refresh-token-${i + 1}`, tokenHash: hash(`seed-refresh-token-${i + 1}`), userId, expiresAt: daysFrom(SEED_DATE, 30, 8), userAgent: "Chrome on Windows", ip: `192.0.2.${10 + i}` } });
    await db.auditLog.upsert({ where: { id: `seed-audit-${i + 1}` }, update: { entity: "ServiceOrder", entityId: tenantOrderIds[0] ?? orderIds[0], action: "STATUS_CHANGE", summary: "SCHEDULED → IN_PROGRESS", before: { status: "SCHEDULED" }, after: { status: "IN_PROGRESS" }, tenantId: tenant.id, userId, branchId, ipAddress: `192.0.2.${10 + i}`, userAgent: "Chrome" }, create: { id: `seed-audit-${i + 1}`, entity: "ServiceOrder", entityId: tenantOrderIds[0] ?? orderIds[0], action: "STATUS_CHANGE", summary: "SCHEDULED → IN_PROGRESS", before: { status: "SCHEDULED" }, after: { status: "IN_PROGRESS" }, tenantId: tenant.id, userId, branchId, ipAddress: `192.0.2.${10 + i}`, userAgent: "Chrome" } });
    await db.otp.upsert({ where: { id: `seed-otp-${i + 1}` }, update: { email: tenant.email, phone: null, codeHash: hash("123456"), type: "RESET_PASSWORD", attempts: 0, consumedAt: null, expiresAt: daysFrom(SEED_DATE, 1, 23), userId, ip: `192.0.2.${10 + i}`, userAgent: "Chrome" }, create: { id: `seed-otp-${i + 1}`, email: tenant.email, codeHash: hash("123456"), type: "RESET_PASSWORD", expiresAt: daysFrom(SEED_DATE, 1, 23), userId, ip: `192.0.2.${10 + i}`, userAgent: "Chrome" } });
    await db.feedback.upsert({ where: { id: `seed-feedback-${i + 1}` }, update: { tenantId: tenant.id, userId, accountId: null, type: i % 2 === 0 ? "SUGGESTION" : "BUG", message: i % 2 === 0 ? "Өвлийн дугуйн сануулгыг автоматаар илгээдэг бол сайн байна." : "Оношилгооны зураг заримдаа удаан ачааллаж байна.", pageUrl: "/dashboard/appointments", userAgent: "Chrome", status: i % 2 === 0 ? "IN_REVIEW" : "NEW", adminNote: null }, create: { id: `seed-feedback-${i + 1}`, tenantId: tenant.id, userId, type: i % 2 === 0 ? "SUGGESTION" : "BUG", message: i % 2 === 0 ? "Өвлийн дугуйн сануулгыг автоматаар илгээдэг бол сайн байна." : "Оношилгооны зураг заримдаа удаан ачааллаж байна.", pageUrl: "/dashboard/appointments", userAgent: "Chrome", status: i % 2 === 0 ? "IN_REVIEW" : "NEW" } });
    await db.feedbackMessage.upsert({ where: { id: `seed-feedback-message-${i + 1}` }, update: { feedbackId: `seed-feedback-${i + 1}`, tenantId: tenant.id, author: "SUBMITTER", message: "Үйлчлүүлэгчийн нэмэлт тайлбар." }, create: { id: `seed-feedback-message-${i + 1}`, feedbackId: `seed-feedback-${i + 1}`, tenantId: tenant.id, author: "SUBMITTER", message: "Үйлчлүүлэгчийн нэмэлт тайлбар." } });
  }

  await db.qPaySettings.upsert({ where: { id: 1 }, update: { username: "seed_qpay_user", password: "seed-only", invoiceCode: "SEED-INVOICE", callbackUrl: "https://example.test/qpay/callback", accessToken: null, refreshToken: null }, create: { id: 1, username: "seed_qpay_user", password: "seed-only", invoiceCode: "SEED-INVOICE", callbackUrl: "https://example.test/qpay/callback" } });
  console.log(`CarService seed дууслаа: ${tenants.length} tenant, ${allBranches.length} branch, ${accounts.length} account, ${vehicles.length} vehicle, ${orderIds.length} order, ${appointmentIds.length} appointment.`);
}
