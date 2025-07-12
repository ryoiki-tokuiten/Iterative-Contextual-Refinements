export interface Recipe {
  id: string;
  title: string;
  description: string;
  ingredients: { name: string; quantity: string }[];
  instructions: string[];
  duration: number; // in minutes
  servings: number;
  imageUrl?: string;
  isFeatured?: boolean;
  tags: string[];
}
