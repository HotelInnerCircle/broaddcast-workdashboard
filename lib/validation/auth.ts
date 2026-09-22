import { z } from "zod";
import { email, password, personName } from "./common";

export const loginSchema = z.object({ email, password: z.string().min(1, "Enter your password") });
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email });
export const resetPasswordSchema = z.object({ token: z.string().min(32).max(128), password });
export const acceptInviteSchema = z.object({ name: personName, password });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password"),
  newPassword: password,
});
