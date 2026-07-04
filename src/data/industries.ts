import type { IndustryKey } from "../lib/types";

export type Industry = {
  value: IndustryKey;
  label: string;
  hint: string;
};

export const industries: Industry[] = [
  {
    value: "restaurant",
    label: "Рестораны и кафе",
    hint: "Для заведений с меню, бронированиями и повторными визитами.",
  },
  {
    value: "beauty",
    label: "Салоны красоты",
    hint: "Подходит для записей, мастеров и программ лояльности.",
  },
  {
    value: "fitness",
    label: "Фитнес и спорт",
    hint: "Для абонементов, тренировок и удержания клиентов.",
  },
  {
    value: "medical",
    label: "Медицина",
    hint: "Для клиник, приемов и аккуратной работы с пациентами.",
  },
  {
    value: "retail",
    label: "Розница",
    hint: "Для витрин, заказов и управления ассортиментом.",
  },
  {
    value: "professional_services",
    label: "Профессиональные услуги",
    hint: "Для агентств, консультантов и сервисных команд.",
  },
  {
    value: "auto_service",
    label: "Автосервис",
    hint: "Для диагностики, ремонта и записи на обслуживание.",
  },
  {
    value: "electronics_repair",
    label: "Ремонт электроники",
    hint: "Для мастерских, заявок и отслеживания статусов ремонта.",
  },
];
