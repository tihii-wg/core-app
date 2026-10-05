import type en from "../en/team";
import type { Messages } from "../../types";

const team: Messages<typeof en> = {
  title: "Участники команды",
  description: "Управляйте командой и правами участников",
  inviteMember: "Пригласить участника",
  memberFallbackName: "Участник компании",
  roles: {
    owner: "Владелец",
    admin: "Администратор",
    manager: "Менеджер",
    member: "Участник",
  },
  members: {
    loading: "Загрузка участников команды...",
    loadFailed: "Не удалось загрузить участников команды",
    emptyTitle: "Участников команды пока нет",
    emptyDescription: "Здесь появятся участники, добавленные в эту компанию.",
    active: "Активен",
    roleFor: "Роль: {{name}}",
    remove: "Удалить",
  },
  remove: {
    title: "Удалить участника команды?",
    description: "{{name}} потеряет доступ к этой компании.",
    removing: "Удаление...",
    confirm: "Удалить",
  },
  invite: {
    title: "Пригласить участника команды",
    description: "Предоставьте существующей учётной записи Core App доступ к этой компании.",
    emailLabel: "Электронная почта",
    emailPlaceholder: "name@company.com",
    roleLabel: "Роль",
    invalidEmail: "Введите корректный адрес электронной почты",
    adding: "Добавление...",
    submit: "Добавить участника",
  },
  toast: {
    adding: "Добавление участника команды...",
    added: "Участник команды добавлен",
    addFailed: "Не удалось добавить участника команды",
    updatingRole: "Обновление роли...",
    roleUpdated: "Роль обновлена",
    roleUpdateFailed: "Не удалось обновить роль",
    removing: "Удаление участника команды...",
    removed: "Участник команды удалён",
    removeFailed: "Не удалось удалить участника команды",
  },
  errors: {
    migrationRequired: "Для управления участниками команды требуется последнее обновление базы данных (supabase/migrations/20260929000300_team_member_rpcs.sql).",
    invalidRole: "Выберите администратора, менеджера или участника",
    emailRequired: "Укажите адрес электронной почты",
    noAddPermission: "У вас нет прав на добавление участников команды",
    accountNotFound: "Нет учётной записи Core App с этим адресом электронной почты. Попросите пользователя сначала зарегистрироваться.",
    alreadyMemberSelf: "Вы уже состоите в этой компании",
    alreadyMember: "Этот пользователь уже является участником команды",
    noAddMemberPermission: "У вас нет прав на добавление этого участника команды",
    noRoleChangePermission: "У вас нет прав на изменение роли этого участника",
    noRemovePermission: "У вас нет прав на удаление этого участника",
  },
};

export default team;
