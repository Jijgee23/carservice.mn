import type { ManualSection } from "@/lib/manual/types";

export const settings: ManualSection = {
  slug: "settings",
  title: "Тохиргоо",
  description: "Байгууллагын мэдээлэл/лого, хэмжих нэгж, QPay мерчант, багц/төлбөр.",
  articles: [
    {
      slug: "settings-org",
      title: "Байгууллагын мэдээлэл, лого засах",
      roleTags: ["owner"],
      whenToUse: "Байгууллагын нэр, регистр, холбоо барих мэдээлэл, лого өөрчлөгдөх үед.",
      prerequisites: [],
      steps: [
        { title: "/dashboard/settings хуудсанд орно" },
        { title: "Байгууллагын нэр, регистр, имэйл, утасны мэдээллийг засна" },
        { title: "Лого хэсэгт шинэ зураг оруулж хадгална (эсвэл \"Устгах\" дарж арилгана)" },
      ],
      rules: [],
      faq: [],
      related: ["settings-units", "settings-qpay"],
    },
    {
      slug: "settings-units",
      title: "Хэмжих нэгж тохируулах",
      roleTags: ["owner"],
      whenToUse: "Үйлчилгээ, сэлбэг/бараа бүртгэхэд ашиглах нэгжүүдийг (ширхэг, цаг, литр, кг, м г.м) тохируулах.",
      prerequisites: [],
      steps: [
        { title: "/dashboard/settings/system хуудсанд орно" },
        { title: "\"Хэмжих нэгжүүд\" хэсгээс шинэ нэгж нэмэх, эсвэл идэвхгүй болгоно" },
      ],
      rules: [],
      faq: [],
      related: ["service-labor", "service-goods-stock"],
    },
    {
      slug: "settings-qpay",
      title: "QPay мерчант холбох (засварын хуудасны төлбөрт)",
      roleTags: ["owner", "payments"],
      whenToUse: "Засварын хуудасны төлбөрийг QR-аар (QPay-ээр) авахыг хүсвэл байгууллагынхаа өөрийн QPay мерчант эрхийг холбоход.",
      prerequisites: ["QPay-аас олгосон хэрэглэгчийн нэр, нууц үг, invoice код байх"],
      steps: [
        { title: "Касс ба Санхүү → «Төлбөрийн аргууд» (/dashboard/payment_methods) хуудсанд орно" },
        { title: "Хүснэгтийн QPay мөрийн «Тохируулах» (эсвэл «Засах») товчийг дарна" },
        { title: "QPay-ийн хэрэглэгчийн нэр, нууц үг, invoice код, callback URL-ээ оруулна" },
        { title: "\"Идэвхтэй\" болгож хадгална" },
      ],
      rules: [
        "Энэ QPay нь ЗАСВАРЫН ХУУДАСНЫ төлбөрт зориулагдсан таны байгууллагын өөрийн мерчант данс — цаг захиалгын хураамжийн QPay (платформынх) огт өөр, тусад нь тохируулагддаг.",
      ],
      faq: [],
      related: ["order-payment", "settings-org"],
    },
    {
      slug: "settings-subscription",
      title: "Багц, төлбөрийн түүх",
      roleTags: ["owner"],
      whenToUse: "Байгууллагын идэвхтэй багцыг (Free/Business/Enterprise) шалгах, сунгах, өмнөх төлбөрийн түүхийг харах.",
      prerequisites: [],
      steps: [
        { title: "/dashboard/settings/subscription хуудсанд орно" },
        { title: "Одоогийн багц, дуусах хугацаа, төлөвийг харна" },
        { title: "Шаардлагатай бол шинэ багц сонгож QPay-ээр төлж сунгана" },
        { title: "Өмнөх төлбөрийн түүхийг доор жагсаалтаар харна" },
      ],
      rules: [],
      faq: [],
      related: ["dashboard-org-subscription"],
    },
  ],
};
