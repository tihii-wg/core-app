import type en from "../en/services";
import type { Messages } from "../../types";

const services: Messages<typeof en> = {
  title: "Услуги",
  loading: "Загрузка услуг...",
  activeCount_one: "{{count}} активная услуга",
  activeCount_few: "{{count}} активные услуги",
  activeCount_many: "{{count}} активных услуг",
  activeCount_other: "{{count}} активной услуги",
  addService: "Добавить услугу",
  searchPlaceholder: "Поиск услуг...",
  loadError: "Не удалось загрузить услуги",
  deleteAriaLabel: "Удалить {{name}}",
  columns: {
    service: "Услуга",
    price: "Цена",
  },
  statuses: {
    active: "Активна",
    inactive: "Неактивна",
  },
  dialogs: {
    createTitle: "Новая услуга",
    createDescription: "Управление услугами рабочего пространства",
    editTitle: "Редактирование услуги",
    editDescription: "Редактирование услуги рабочего пространства",
    deleteTitle: "Удалить услугу?",
    deleteDescription: "Подтвердите удаление выбранной услуги.",
    deleteConfirm: "Вы уверены, что хотите удалить <strong>{{name}}</strong>?",
  },
  form: {
    serviceNameRequiredLabel: "Название услуги *",
    serviceNameLabel: "Название услуги",
    serviceRequired: "Укажите услугу",
    serviceNameRequired: "Укажите название услуги",
    priceLabel: "Цена ({{currency}}) *",
    priceRequired: "Укажите цену",
    priceNegative: "Цена не может быть отрицательной",
    descriptionLabel: "Описание",
    descriptionPlaceholder: "Краткое описание услуги...",
  },
  combobox: {
    placeholder: "Услуга",
    priceAriaLabel: "Цена",
    create: "Создать: <strong>{{name}}</strong>",
  },
  toast: {
    creating: "Создание услуги",
    created: "Услуга успешно создана",
    duplicateName: "Услуга с таким названием уже существует",
    genericError: "Что-то пошло не так",
    updating: "Обновление услуги",
    updated: "Услуга обновлена",
    deleting: "Удаление услуги",
    deleted: "Услуга удалена",
    deleteFailed: "Не удалось удалить услугу",
  },
  errors: {
    duplicateName: "Услуга с таким названием уже существует",
    createPermission: "У вас нет прав на создание услуг в этом рабочем пространстве.",
    notFound: "Услуга не найдена.",
    editPermission: "У вас нет прав на редактирование этой услуги.",
    usedInOrders: "Эта услуга используется в заказах и не может быть удалена. Вместо этого сделайте её неактивной.",
    deletePermission: "У вас нет прав на удаление этой услуги.",
  },
};

export default services;
