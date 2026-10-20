import { permanentRedirect } from "next/navigation";

// Нүүр хуудас «/» руу шилжсэн — хуучин холбоос/индексийг 308-аар дамжуулна.
export default function LegacyLandingPage() {
  permanentRedirect("/");
}
