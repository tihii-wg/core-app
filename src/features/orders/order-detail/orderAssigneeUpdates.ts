import type { Order } from "../../../lib/types";
import type { OrderTeamMemberInput } from "../orderTeam";

type UpdateOrderFn = (input: Record<string, unknown>) => Promise<Order>;

export async function updateOrderAssignee(args: {
  selectedOrder: Order;
  assignedEmployeeId: string;
  isAssigneeUpdating: boolean;
  closedContentLocked: boolean;
  updateOrder: UpdateOrderFn;
  onOrderUpdated: (order: Order) => void;
}) {
  const { selectedOrder, assignedEmployeeId, isAssigneeUpdating, closedContentLocked, updateOrder, onOrderUpdated } =
    args;
  if (isAssigneeUpdating || closedContentLocked) return;
  if ((selectedOrder.assignedEmployeeId || "") === assignedEmployeeId) return;

  try {
    const updated = await updateOrder({
      orderId: selectedOrder.id,
      vehicleId: selectedOrder.vehicleId ?? undefined,
      device: selectedOrder.device,
      carNumber: selectedOrder.carNumber,
      vin: selectedOrder.vin,
      description: selectedOrder.description,
      assignedEmployeeId,
      team: (selectedOrder.team ?? [])
        .filter((member) => member.employeeId !== selectedOrder.assignedEmployeeId)
        .map((member) => ({ employeeId: member.employeeId, role: member.role })),
      deadline: selectedOrder.deadline,
    });
    onOrderUpdated(updated);
  } catch {
    return;
  }
}

export async function updateOrderTeam(args: {
  selectedOrder: Order;
  team: OrderTeamMemberInput[];
  isAssigneeUpdating: boolean;
  closedContentLocked: boolean;
  updateOrder: UpdateOrderFn;
  onOrderUpdated: (order: Order) => void;
}) {
  const { selectedOrder, team, isAssigneeUpdating, closedContentLocked, updateOrder, onOrderUpdated } = args;
  if (isAssigneeUpdating || closedContentLocked) return;

  try {
    const updated = await updateOrder({
      orderId: selectedOrder.id,
      vehicleId: selectedOrder.vehicleId ?? undefined,
      device: selectedOrder.device,
      carNumber: selectedOrder.carNumber,
      vin: selectedOrder.vin,
      description: selectedOrder.description,
      assignedEmployeeId: selectedOrder.assignedEmployeeId,
      team,
      deadline: selectedOrder.deadline,
    });
    onOrderUpdated(updated);
  } catch {
    return;
  }
}
