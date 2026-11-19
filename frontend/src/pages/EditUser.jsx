// Editing now happens in the edit dialog on Manage Existing Users.
// Old links to /manage-users/edit-user/:id open that dialog for the same user.
import { Navigate, useParams } from "react-router-dom";

const EditUser = () => {
  const { id } = useParams();
  return <Navigate to="/manage-users/existing-users" replace state={{ editId: id }} />;
};

export default EditUser;
