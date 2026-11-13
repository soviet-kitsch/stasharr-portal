export interface LibraryStudioOptionDto {
  id: string;
  name: string;
  childStudios?: Array<{ id: string; name: string }>;
}
