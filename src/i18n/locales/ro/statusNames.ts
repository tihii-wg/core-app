import type en from "../en/statusNames";
import type { Messages } from "../../types";

const statusNames: Messages<typeof en> = {
  order: {
    approval: "În aprobare",
    waitingPart: "Așteaptă piesa",
    waitingPayment: "Așteaptă plata",
  },
  estimate: {
    draft: "Ciornă",
    pending: "În așteptare",
    sent: "Trimis",
    orderCreated: "Comandă creată",
    rejected: "Respins",
  },
  lead: {
    newInquiry: "Solicitare nouă",
    convertedToOrder: "Transformat în comandă",
    successfulSale: "Vânzare reușită",
    tooExpensive: "Prea scump",
    changedMind: "S-a răzgândit",
    mistakenInquiry: "Solicitare greșită",
  },
  invoice: {
    issued: "Emisă",
    paid: "Achitată",
  },
  transfer: {
    readyToShip: "Gata de expediere",
    inTransit: "În tranzit",
    received: "Recepționat",
    canceled: "Anulat",
  },
  task: {
    toDo: "De făcut",
    postponed: "Amânate",
    done: "Gata",
  },
};

export default statusNames;
