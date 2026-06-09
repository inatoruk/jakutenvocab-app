export type Category = "Vocab" | "Paraphrase" | "Listening" | "Writing";

export const CATEGORIES: Category[] = ["Vocab", "Paraphrase", "Listening", "Writing"];

export type Status = 0 | 1 | 2;

export type Vocab = {
    id: string;
    term: string;
    meaning: string;
    context: string;
    category: Category;
    status: Status;
    created_at: string;
};
