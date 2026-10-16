export type Step = { title: string; body: string };

export type Answer = {
  title: string;
  summary: string;
  steps: Step[];
};

export const groupTripAnswer: Answer = {
  title: "5 steps for planning a group trip",
  summary:
    "Settle the basics, pick a place and a point person, book big items early, keep days loose, and split costs as you go.",
  steps: [
    {
      title: "Agree on the basics together",
      body: "Before anyone books anything, get everyone on a quick call or group chat to settle the big three: dates, rough budget, and the kind of trip people want. Ask each person for their budget privately, then plan around the lowest number so no one feels pressured.",
    },
    {
      title: "Pick a destination and assign a point person",
      body: "Narrow it down to two or three options that fit the dates and budget, then vote. Once you've chosen, name one organizer to keep things moving, or split responsibilities so one person handles lodging and another handles activities.",
    },
    {
      title: "Book the big-ticket items early",
      body: "Lock in transportation and lodging first, since prices rise as dates get closer. Have everyone confirm before booking, and collect deposits right away so no one drops out after money is committed.",
    },
    {
      title: "Plan loose days with a few must-dos",
      body: "Pick two or three things the whole group wants to do, then leave plenty of open time. Groups move slower than individuals, and people will want breaks.",
    },
    {
      title: "Split costs as you go",
      body: "Use a shared expense app or a simple spreadsheet, and settle up during the trip instead of after. It keeps things fair and avoids awkward reminders later.",
    },
  ],
};