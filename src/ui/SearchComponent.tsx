import { useState } from "react";
import { Input } from "./Input";
import { Search } from "lucide-react";

export default function SearchComponent() {
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <div className="hidden  md:block relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#939699]" />
      <Input
        type="text"
        placeholder="Search..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="w-64 h-9 pl-9 border-[#c9cbcc] focus:border-[#1973e1] focus:ring-2  focus:ring-[#1973e1]/20 text-sm"
      />
    </div>
  );
}
