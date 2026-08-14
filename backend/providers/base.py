from abc import ABC,abstractmethod
class ListingProvider(ABC):
 @abstractmethod
 def discover(self):...
 @abstractmethod
 def images(self,listing):...
 def automation_allowed(self):return False
 def image_storage_allowed(self):return False
