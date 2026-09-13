import supabase from "./supabase";

export async function createService() {
  const { data, error } = await supabase
    .from("services")
		.insert([{
			workspace_id: "someValue",
			service_name: "otherValue",
			service_price: "",
			
		}])
    .select();
  if (error) throw new Error(error.message);

  return data;
}
