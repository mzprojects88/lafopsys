"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";

const passwordSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

const magicLinkSchema = z.object({
  email: z.string().email("Enter a valid email address"),
});

function PasswordForm() {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof passwordSchema>>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { email: "admin@littlearkfoundation.org", password: "" },
  });

  async function onSubmit() {
    toast.success("Signed in (demo — no real authentication)");
    router.push("/dashboard");
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <FieldGroup>
        <Field data-invalid={!!errors.email}>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input id="email" type="email" placeholder="you@littlearkfoundation.org" {...register("email")} />
          <FieldError errors={[errors.email]} />
        </Field>
        <Field data-invalid={!!errors.password}>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input id="password" type="password" placeholder="••••••••" {...register("password")} />
          <FieldError errors={[errors.password]} />
        </Field>
        <Button type="submit" disabled={isSubmitting} className="w-full">
          Sign in
        </Button>
      </FieldGroup>
    </form>
  );
}

function MagicLinkForm() {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof magicLinkSchema>>({
    resolver: zodResolver(magicLinkSchema),
    defaultValues: { email: "" },
  });

  async function onSubmit() {
    toast.success("Magic link sent (demo — no email is actually sent)");
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <FieldGroup>
        <Field data-invalid={!!errors.email}>
          <FieldLabel htmlFor="magic-email">Email</FieldLabel>
          <Input id="magic-email" type="email" placeholder="you@littlearkfoundation.org" {...register("email")} />
          <FieldError errors={[errors.email]} />
        </Field>
        <Button type="submit" disabled={isSubmitting} className="w-full">
          Send magic link
        </Button>
      </FieldGroup>
    </form>
  );
}

export default function LoginPage() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="items-center text-center">
        <Image src="/logo/laf-mark.png" alt="Little Ark Foundation" width={48} height={48} />
        <CardTitle className="text-lg">LAF Operating System</CardTitle>
        <CardDescription>Sign in to continue — this is a UI prototype, not a live login.</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="password">
          <TabsList className="w-full">
            <TabsTrigger value="password">Password</TabsTrigger>
            <TabsTrigger value="magic-link">Magic Link</TabsTrigger>
          </TabsList>
          <TabsContent value="password" className="pt-4">
            <PasswordForm />
          </TabsContent>
          <TabsContent value="magic-link" className="pt-4">
            <MagicLinkForm />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
