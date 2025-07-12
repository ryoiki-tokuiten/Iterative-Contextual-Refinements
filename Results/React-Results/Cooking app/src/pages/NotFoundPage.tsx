import { Link } from 'react-router-dom';

const NotFoundPage = () => {
  return (
    <div className="flex flex-col items-center justify-center text-center h-full min-h-[calc(100vh-200px)] px-4">
      <h1 className="text-6xl font-bold text-gray-800">404</h1>
      <p className="text-2xl text-gray-600 mt-4">Page Not Found</p>
      <p className="text-gray-500 mt-2">Sorry, the page you are looking for does not exist.</p>
      <Link 
        to="/" 
        className="mt-8 px-6 py-3 bg-green-600 text-white font-semibold rounded-lg shadow-md hover:bg-green-700 transition-colors duration-300"
      >
        Go back to Homepage
      </Link>
    </div>
  );
};

export default NotFoundPage;
