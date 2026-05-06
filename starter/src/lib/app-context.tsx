import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";
import { useNavigate, useLocation } from "react-router-dom";
import type {
  User,
  Client,
  Employee,
  Order,
  InventoryItem,
  Service,
  Invoice,
  Transaction,
  AuthState,
  OrderStatus,
  InvoiceStatus,
} from "../../../src/lib/types";
import {
  mockUser,
  mockClients,
  mockEmployees,
  mockOrders,
  mockInventory,
  mockServices,
  mockInvoices,
  mockTransactions,
  generateId,
  generateOrderNumber,
  generateInvoiceNumber,
} from "./mock-data";

interface AppContextType {
  // Auth
  auth: AuthState;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  register: (data: {
    companyName: string;
    ownerName: string;
    email: string;
    password: string;
  }) => Promise<boolean>;

  // Navigation
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  mobileSidebarOpen: boolean;
  setMobileSidebarOpen: (open: boolean) => void;

  // Data
  clients: Client[];
  employees: Employee[];
  orders: Order[];
  inventory: InventoryItem[];
  services: Service[];
  invoices: Invoice[];
  transactions: Transaction[];

  // Actions
  addClient: (client: Omit<Client, "id" | "createdAt" | "balance">) => void;
  updateClient: (id: string, client: Partial<Client>) => void;
  addOrder: (
    order: Omit<Order, "id" | "orderNumber" | "createdAt" | "updatedAt">
  ) => void;
  updateOrderStatus: (orderId: string, status: OrderStatus) => void;
  addInventoryItem: (item: Omit<InventoryItem, "id" | "status">) => void;
  updateInventoryItem: (id: string, item: Partial<InventoryItem>) => void;
  updateInventoryQuantity: (itemId: string, quantity: number) => void;
  addService: (service: Omit<Service, "id">) => void;
  addInvoice: (
    invoice: Omit<Invoice, "id" | "invoiceNumber" | "createdAt">
  ) => void;
  updateInvoiceStatus: (invoiceId: string, status: InvoiceStatus) => void;
  addEmployee: (
    employee: Omit<Employee, "id" | "assignedTasks" | "completedTasks">
  ) => void;
  updateEmployee: (id: string, employee: Partial<Employee>) => void;

  // Helpers
  formatCurrency: (amount: number) => string;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();

  // Auth state
  const [auth, setAuth] = useState<AuthState>({
    isAuthenticated: false,
    user: null,
  });

  // Navigation state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Data state
  const [clients, setClients] = useState<Client[]>(mockClients);
  const [employees, setEmployees] = useState<Employee[]>(mockEmployees);
  const [orders, setOrders] = useState<Order[]>(mockOrders);
  const [inventory, setInventory] = useState<InventoryItem[]>(mockInventory);
  const [services, setServices] = useState<Service[]>(mockServices);
  const [invoices, setInvoices] = useState<Invoice[]>(mockInvoices);
  const [transactions, setTransactions] =
    useState<Transaction[]>(mockTransactions);

  // Check for existing auth on mount
  useEffect(() => {
    const storedAuth = localStorage.getItem("coreapp_auth");
    if (storedAuth) {
      try {
        const parsed = JSON.parse(storedAuth);
        setAuth(parsed);
      } catch {
        localStorage.removeItem("coreapp_auth");
      }
    }
  }, []);

  // Redirect based on auth state
  useEffect(() => {
    const publicPaths = ["/login", "/register", "/forgot-password"];
    const isPublicPath = publicPaths.includes(location.pathname);

    if (auth.isAuthenticated && isPublicPath) {
      navigate("/dashboard", { replace: true });
    } else if (!auth.isAuthenticated && !isPublicPath) {
      navigate("/login", { replace: true });
    }
  }, [auth.isAuthenticated, location.pathname, navigate]);

  // Auth actions
  const login = useCallback(
    async (email: string, password: string): Promise<boolean> => {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      if (email && password.length >= 6) {
        const authState: AuthState = {
          isAuthenticated: true,
          user: { ...mockUser, email },
        };
        setAuth(authState);
        localStorage.setItem("coreapp_auth", JSON.stringify(authState));
        navigate("/dashboard", { replace: true });
        return true;
      }
      return false;
    },
    [navigate]
  );

  const logout = useCallback(() => {
    setAuth({ isAuthenticated: false, user: null });
    localStorage.removeItem("coreapp_auth");
    navigate("/login", { replace: true });
  }, [navigate]);

  const register = useCallback(
    async (data: {
      companyName: string;
      ownerName: string;
      email: string;
      password: string;
    }): Promise<boolean> => {
      await new Promise((resolve) => setTimeout(resolve, 1500));

      if (
        data.email &&
        data.password.length >= 6 &&
        data.companyName &&
        data.ownerName
      ) {
        const authState: AuthState = {
          isAuthenticated: true,
          user: {
            id: generateId("user"),
            email: data.email,
            name: data.ownerName,
            companyName: data.companyName,
            role: "admin",
          },
        };
        setAuth(authState);
        localStorage.setItem("coreapp_auth", JSON.stringify(authState));
        navigate("/dashboard", { replace: true });
        return true;
      }
      return false;
    },
    [navigate]
  );

  // Data actions
  const addClient = useCallback(
    (clientData: Omit<Client, "id" | "createdAt" | "balance">) => {
      const newClient: Client = {
        ...clientData,
        id: generateId("client"),
        createdAt: new Date().toISOString().split("T")[0],
        balance: 0,
      };
      setClients((prev) => [newClient, ...prev]);
    },
    []
  );

  const updateClient = useCallback(
    (id: string, clientData: Partial<Client>) => {
      setClients((prev) =>
        prev.map((client) =>
          client.id === id ? { ...client, ...clientData } : client
        )
      );
    },
    []
  );

  const addOrder = useCallback(
    (
      orderData: Omit<Order, "id" | "orderNumber" | "createdAt" | "updatedAt">
    ) => {
      const now = new Date().toISOString().split("T")[0];
      const newOrder: Order = {
        ...orderData,
        id: generateId("order"),
        orderNumber: generateOrderNumber(),
        createdAt: now,
        updatedAt: now,
      };
      setOrders((prev) => [newOrder, ...prev]);
    },
    []
  );

  const updateOrderStatus = useCallback(
    (orderId: string, status: OrderStatus) => {
      setOrders((prev) =>
        prev.map((order) =>
          order.id === orderId
            ? {
                ...order,
                status,
                updatedAt: new Date().toISOString().split("T")[0],
              }
            : order
        )
      );
    },
    []
  );

  const addInventoryItem = useCallback(
    (itemData: Omit<InventoryItem, "id" | "status">) => {
      const status =
        itemData.quantity === 0
          ? "out-of-stock"
          : itemData.quantity < itemData.minQuantity
          ? "low-stock"
          : "in-stock";

      const newItem: InventoryItem = {
        ...itemData,
        id: generateId("inv"),
        status,
      };
      setInventory((prev) => [newItem, ...prev]);
    },
    []
  );

  const updateInventoryItem = useCallback(
    (id: string, itemData: Partial<InventoryItem>) => {
      setInventory((prev) =>
        prev.map((item) => {
          if (item.id !== id) return item;

          const updatedItem = { ...item, ...itemData };
          const status =
            updatedItem.quantity === 0
              ? "out-of-stock"
              : updatedItem.quantity < updatedItem.minQuantity
              ? "low-stock"
              : "in-stock";

          return { ...updatedItem, status };
        })
      );
    },
    []
  );

  const updateInventoryQuantity = useCallback(
    (itemId: string, quantity: number) => {
      setInventory((prev) =>
        prev.map((item) => {
          if (item.id !== itemId) return item;

          const status =
            quantity === 0
              ? "out-of-stock"
              : quantity < item.minQuantity
              ? "low-stock"
              : "in-stock";

          return { ...item, quantity, status };
        })
      );
    },
    []
  );

  const addService = useCallback((serviceData: Omit<Service, "id">) => {
    const newService: Service = {
      ...serviceData,
      id: generateId("svc"),
    };
    setServices((prev) => [newService, ...prev]);
  }, []);

  const addInvoice = useCallback(
    (invoiceData: Omit<Invoice, "id" | "invoiceNumber" | "createdAt">) => {
      const newInvoice: Invoice = {
        ...invoiceData,
        id: generateId("inv"),
        invoiceNumber: generateInvoiceNumber(),
        createdAt: new Date().toISOString().split("T")[0],
      };
      setInvoices((prev) => [newInvoice, ...prev]);
    },
    []
  );

  const updateInvoiceStatus = useCallback(
    (invoiceId: string, status: InvoiceStatus) => {
      setInvoices((prev) =>
        prev.map((invoice) =>
          invoice.id === invoiceId
            ? {
                ...invoice,
                status,
                paidAt:
                  status === "paid"
                    ? new Date().toISOString().split("T")[0]
                    : invoice.paidAt,
              }
            : invoice
        )
      );
    },
    []
  );

  const addEmployee = useCallback(
    (
      employeeData: Omit<Employee, "id" | "assignedTasks" | "completedTasks">
    ) => {
      const newEmployee: Employee = {
        ...employeeData,
        id: generateId("emp"),
        assignedTasks: 0,
        completedTasks: 0,
      };
      setEmployees((prev) => [newEmployee, ...prev]);
    },
    []
  );

  const updateEmployee = useCallback(
    (id: string, employeeData: Partial<Employee>) => {
      setEmployees((prev) =>
        prev.map((employee) =>
          employee.id === id ? { ...employee, ...employeeData } : employee
        )
      );
    },
    []
  );

  const formatCurrency = useCallback((amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);
  }, []);

  return (
    <AppContext.Provider
      value={{
        auth,
        login,
        logout,
        register,
        sidebarCollapsed,
        setSidebarCollapsed,
        mobileSidebarOpen,
        setMobileSidebarOpen,
        clients,
        employees,
        orders,
        inventory,
        services,
        invoices,
        transactions,
        addClient,
        updateClient,
        addOrder,
        updateOrderStatus,
        addInventoryItem,
        updateInventoryItem,
        updateInventoryQuantity,
        addService,
        addInvoice,
        updateInvoiceStatus,
        addEmployee,
        updateEmployee,
        formatCurrency,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error("useApp must be used within an AppProvider");
  }
  return context;
}
