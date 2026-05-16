import { useMutation } from "@tanstack/react-query";
import {createProfile as createProfileApi} from "../../services/apiProfiles"

export function useProfile() {
	return useMutation({
mutationFn:createProfileApi,

	})
}