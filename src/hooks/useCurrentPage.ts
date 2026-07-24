import { useLocation } from "react-router-dom"

export default function useCurrentPage() {
	const location =useLocation()
return location.pathname.split("/")[3]
}