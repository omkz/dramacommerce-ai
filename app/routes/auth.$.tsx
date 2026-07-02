import { Auth } from "@auth/core";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authConfig } from "~/services/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  return Auth(request, authConfig);
}

export async function action({ request }: ActionFunctionArgs) {
  return Auth(request, authConfig);
}
