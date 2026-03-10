export type Division = {
  id: string;
  name: string;
  minAge: number;
  maxAge: number;
  gender: 'M' | 'F' | 'C';
  maxRoster: number;
  format: string;
  duration: number;
};

export const DEFAULT_DIVISIONS: Division[] = [
  { id: 'd1', name: 'U8 Boys', minAge: 7, maxAge: 8, gender: 'M', maxRoster: 8, format: '5v5', duration: 40 },
  { id: 'd2', name: 'U8 Girls', minAge: 7, maxAge: 8, gender: 'F', maxRoster: 8, format: '5v5', duration: 40 },
  { id: 'd3', name: 'U10 Boys', minAge: 9, maxAge: 10, gender: 'M', maxRoster: 12, format: '7v7', duration: 50 },
  { id: 'd4', name: 'U10 Girls', minAge: 9, maxAge: 10, gender: 'F', maxRoster: 12, format: '7v7', duration: 50 },
  { id: 'd5', name: 'U12 Boys', minAge: 11, maxAge: 12, gender: 'M', maxRoster: 16, format: '9v9', duration: 60 },
  { id: 'd6', name: 'U12 Girls', minAge: 11, maxAge: 12, gender: 'F', maxRoster: 16, format: '9v9', duration: 60 },
  { id: 'd7', name: 'U14 Boys', minAge: 13, maxAge: 14, gender: 'M', maxRoster: 18, format: '11v11', duration: 70 },
  { id: 'd8', name: 'U14 Girls', minAge: 13, maxAge: 14, gender: 'F', maxRoster: 18, format: '11v11', duration: 70 },
];
