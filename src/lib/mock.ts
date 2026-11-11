export type Lot = {
  id: number;
  title: string;
  donor: string;
  startingBid: number;
  currentBid: number;
  status: "upcoming" | "live" | "sold";
  winnerPaddle?: number;
};

export type Paddle = {
  number: number;
  name: string;
  holdAmount: number;
  status: "active" | "captured" | "voided";
};

export const auction = {
  name: "Maple Street Elementary Spring Gala",
  increment: 25,
};

export const lots: Lot[] = [
  { id: 1, title: "Signed Class Quilt", donor: "Room 4B", startingBid: 50, currentBid: 175, status: "sold", winnerPaddle: 12 },
  { id: 2, title: "Principal for a Day", donor: "Mrs. Alvarez", startingBid: 100, currentBid: 350, status: "live" },
  { id: 3, title: "Family Pizza Night Basket", donor: "Tony's Pizzeria", startingBid: 40, currentBid: 40, status: "upcoming" },
  { id: 4, title: "Weekend Cabin Getaway", donor: "The Okafor Family", startingBid: 300, currentBid: 300, status: "upcoming" },
];

export const paddles: Paddle[] = [
  { number: 7, name: "Dana R.", holdAmount: 500, status: "active" },
  { number: 12, name: "Marcus T.", holdAmount: 250, status: "captured" },
  { number: 23, name: "Priya S.", holdAmount: 750, status: "active" },
  { number: 31, name: "Chris L.", holdAmount: 300, status: "voided" },
];

export const bidTicker = [
  { paddle: 23, amount: 350, ago: "just now" },
  { paddle: 7, amount: 325, ago: "8s ago" },
  { paddle: 23, amount: 300, ago: "21s ago" },
  { paddle: 31, amount: 275, ago: "40s ago" },
];

export const moneyBoard = { held: 1250, captured: 175, voided: 300, paidOut: 0 };

export const currency = (n: number) => `$${n.toLocaleString("en-US")}`;
