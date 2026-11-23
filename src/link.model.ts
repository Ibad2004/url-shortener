import { Schema, model } from "mongoose";

export interface LinkFields {
  code: string;
  url: string;
  clicks: number;
  expiresAt: Date | null; // used in part 2
  createdAt: Date;
  updatedAt: Date;
}

const linkSchema = new Schema<LinkFields>(
  {
    code: { type: String, required: true, unique: true },
    url: { type: String, required: true },
    clicks: { type: Number, default: 0 },
    expiresAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        const { _id, __v, ...rest } = ret;
        return { id: String(_id), ...rest };
      },
    },
  },
);

export const Link = model<LinkFields>("Link", linkSchema);
